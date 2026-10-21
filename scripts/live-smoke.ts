/** Opt-in real-host smoke test. Uses only its own server, tmux socket and XDG directories. */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { OpenCode } from "@opencode/client"
import { build } from "./build.js"

const root = await mkdtemp("/tmp/opencode/attention-inbox-live-").catch((error: NodeJS.ErrnoException) => {
  if (error.code !== "EACCES" && error.code !== "ENOENT") throw error
  return mkdtemp(join(tmpdir(), "opencode-attention-inbox-live-"))
})
const repo = resolve(import.meta.dir, "..")
const socket = `attention-${process.pid}`
const env: Record<string, string> = Object.fromEntries(Object.entries(process.env)
  .filter(([key, value]) => !key.startsWith("OPENCODE_") && value !== undefined)) as Record<string, string>
Object.assign(env, { HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), TERM: "xterm-256color",
  OPENCODE_SERVER_PASSWORD: crypto.randomUUID() })
env.OPENCODE_PASSWORD = env.OPENCODE_SERVER_PASSWORD!
for (const path of [env.HOME!, join(env.XDG_CONFIG_HOME!, "opencode"), join(root, "a"), join(root, "b")]) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}
const run = async (args: string[], cwd = root) => {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  if (code) throw new Error(`${args[0]} failed: ${err}`)
  return out
}
const tmux = (...args: string[]) => run(["tmux", "-L", socket, ...args])
const wait = async (condition: () => Promise<boolean>, label: string) => {
  for (let i = 0; i < 200; i++) {
    if (await condition().catch(() => false)) return
    await Bun.sleep(100)
  }
  throw new Error(`Timed out: ${label}`)
}
const capture = () => tmux("capture-pane", "-p", "-t", "inbox:0.0")
const clickText = async (needle: string) => {
  const lines = (await capture()).split("\n")
  let row = -1
  for (let index = 0; index < lines.length; index++) if (lines[index]!.includes(needle)) row = index
  assert(row >= 0, `mouse target: ${needle}`)
  const column = Bun.stringWidth(lines[row]!.slice(0, lines[row]!.indexOf(needle))) + 1
  await tmux("send-keys", "-t", "inbox", "-l", `\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`)
}
const save = async (name: string) => { const text = await capture(); await writeFile(join(root, `${name}.txt`), text); return text }
const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label) }
await build()
// Exercise an unpacked npm archive inside node_modules, not the source checkout.
const packed = JSON.parse(await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", root], repo)) as { filename: string }[]
const installed = join(root, "node_modules", "opencode-attention-inbox")
await mkdir(installed, { recursive: true })
await run(["tar", "-xzf", join(root, packed[0]!.filename), "--strip-components=1", "-C", installed])
const config = { "$schema": "https://opencode.ai/v2/cli.json", highlights: false, animations: false,
  attention: { notifications: false, sound: false }, tabs: { mode: "on", scope: "global" },
  plugins: [{ package: join(installed, "dist"), options: { pollIntervalMs: 5000 } }] }
await writeFile(join(env.XDG_CONFIG_HOME!, "opencode", "cli.json"), JSON.stringify(config))
for (const name of ["a", "b"]) {
  const cwd = join(root, name)
  await run(["git", "init", "-q"], cwd)
  await run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", name], cwd)
}
await run(["git", "worktree", "add", "-qb", "fixture-tree", join(root, "tree")], join(root, "a"))
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const port = reservation.port!
reservation.stop(true)
const url = `http://127.0.0.1:${port}`
const server = Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  env, cwd: root, stdout: Bun.file(join(root, "server.stdout")), stderr: Bun.file(join(root, "server.stderr")),
})
let failed = false
try {
  const client = OpenCode.make({ baseUrl: url,
    headers: { authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString("base64")}` } })
  await wait(async () => !!await client.server.info(), "private server startup")
  const primary = await client.session.create({ title: "Fixture primary", location: { directory: join(root, "a") } })
  const other = await client.session.create({ title: "Fixture foreign question", location: { directory: join(root, "b") } })
  const tree = await client.session.create({ title: "Fixture worktree question", location: { directory: join(root, "tree") } })
  const done = await client.session.create({ title: "Fixture completed", location: { directory: join(root, "a") } })
  // Import native metadata through the supported API: no model call or store edits.
  await client.session.remove({ sessionID: done.id })
  const imported = await client.session.import({ info: { ...done, outcome: "succeeded", time: { ...done.time, idle: Date.now() } }, messages: [], location: done.location })
  assert(imported.projectID === primary.projectID && imported.outcome === "succeeded" && imported.time.idle! > (imported.time.viewed ?? 0), "imported native completion fixture")
  const archived = await client.session.create({ title: "Fixture archived", location: { directory: join(root, "b") } })
  await client.session.update({ sessionID: archived.id, archived: true })
  assert((await client.session.list({ limit: 100 })).data.some(session => session.id === archived.id), "unfiltered inventory includes archives")
  assert(primary.projectID === tree.projectID && primary.projectID !== other.projectID, "fixture projects/worktree identity")
  const makeForm = (sessionID: string) => client.session.form.create({ sessionID, title: "Fixture question",
    fields: [{ key: "answer", type: "string", title: "Fixture answer" }] })
  const foreignForm = await makeForm(other.id)
  await makeForm(tree.id)
  await client.session.update({ sessionID: other.id, permissions: [{ action: "fixture", resource: "*", effect: "ask" }] })
  const permissionEffect = client.permission.create({ sessionID: other.id, action: "fixture", resources: ["fixture"] }).catch(() => undefined)
  await wait(async () => (await client.permission.list({ sessionID: other.id })).length === 1, "native permission fixture")
  const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
  const command = ["env", ...Object.entries(env).filter(([key]) => key === "HOME" || key.startsWith("XDG_") || key === "TERM" || key.startsWith("OPENCODE_"))
    .map(([key, value]) => `${key}=${value}`), "opencode", "--server", url, "--session", primary.id, join(root, "a")]
    .map(shellQuote).join(" ")
  await tmux("new-session", "-d", "-s", "inbox", "-x", "160", "-y", "48", command)
  await wait(async () => (await capture()).includes("Needs attention"), "packed plugin footer")
  await wait(async () => (await capture()).includes("Fixture worktree question"), "worktree included in project")
  await wait(async () => (await capture()).includes("Done · unread"), "native completion badge")
  let screen = await save("01-project")
  assert(!screen.includes("Fixture foreign question"), "foreign project must be filtered")
  await clickText("Current project")
  await wait(async () => (await capture()).includes("All projects"), "scope mouse control")
  await wait(async () => (await capture()).includes("Fixture foreign question"), "all-project inventory")
  await wait(async () => (await capture()).includes("Permission · Question"), "multiple native request badges")
  await tmux("send-keys", "-t", "inbox", "C-x", "v")
  await wait(async () => (await capture()).includes("Current project"), "scope keyboard shortcut")
  await tmux("send-keys", "-t", "inbox", "C-x", "v")
  await wait(async () => (await capture()).includes("All projects"), "scope keyboard toggle back")
  await save("02-all")
  await client.session.form.cancel({ sessionID: other.id, formID: foreignForm.id })
  const permissions = await client.permission.list({ sessionID: other.id })
  await client.permission.reply({ sessionID: other.id, requestID: permissions[0]!.id, decision: "once" })
  await permissionEffect
  await wait(async () => !(await capture()).includes("Fixture foreign question"), "foreign request resolved live")
  await save("03-resolved")
  // Acknowledgment in another client must clear the native completion remotely.
  const completed = await client.session.get({ sessionID: done.id })
  await client.session.view({ sessionID: done.id, idle: completed.time.idle! })
  await wait(async () => !(await capture()).includes("Fixture completed"), "another client viewed completion")
  // Focus and escape must not submit or approve anything; ordinary prompt typing resumes.
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("Esc back"), "inbox focus")
  await tmux("send-keys", "-t", "inbox", "Escape")
  await wait(async () => !(await capture()).includes("Esc back"), "inbox blur")
  await tmux("send-keys", "-t", "inbox", "-l", "fixture-unsent")
  await wait(async () => (await capture()).includes("fixture-unsent"), "prompt focus restored")
  await tmux("send-keys", "-t", "inbox", "C-u")
  await save("04-focus")
  // Select the owning worktree session, not a session in the launch directory.
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("Esc back"), "inbox refocus")
  await tmux("send-keys", "-t", "inbox", "Enter")
  await wait(async () => (await capture()).includes("Fixture answer"), "navigate to native form")
  screen = await save("05-navigation")
  assert((await client.session.form.list({ sessionID: tree.id })).length === 1, "opening must not answer a question")
  await wait(async () => (await capture()).includes("Needs attention"), "footer survives navigation")
  const secondForeignForm = await makeForm(other.id)
  await wait(async () => (await capture()).includes("Fixture foreign question"), "live request after navigation")
  await clickText("Fixture foreign question")
  await wait(async () => (await capture()).includes("~/b:master"), "mouse navigation preserves foreign location")
  assert((await client.session.form.list({ sessionID: other.id })).length === 1, "clicking must not answer a question")
  await save("06-mouse")
  await client.session.form.cancel({ sessionID: other.id, formID: secondForeignForm.id })
  await wait(async () => !(await capture()).includes("Fixture answer"), "native form resolved externally")
  await tmux("resize-window", "-t", "inbox", "-x", "90", "-y", "28")
  await wait(async () => !(await capture()).includes("Needs attention"), "narrow sidebar hidden")
  await wait(async () => (await capture()).includes("Build ·"), "narrow prompt ready")
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("Needs attention"), "narrow native picker")
  await save("07-narrow-picker")
  console.log(`Live packed-plugin smoke passed. Evidence: ${root}`)
} catch (error) {
  failed = true
  await save("failure").catch(() => {})
  await tmux("send-keys", "-t", "inbox", "Escape", "C-u").catch(() => {})
  await tmux("send-keys", "-t", "inbox", "-l", "/plugins").catch(() => {})
  await tmux("send-keys", "-t", "inbox", "Enter").catch(() => {})
  await Bun.sleep(300)
  await save("failure-plugins").catch(() => {})
  console.error(`Live test failed. Isolated evidence: ${root}`)
  throw error
} finally {
  if (!(failed && process.env.INBOX_LIVE_KEEP_ON_FAILURE === "1")) {
    await tmux("kill-server").catch(() => {})
    server.kill()
    await server.exited
  } else console.error(`Debug processes retained: tmux socket ${socket}; server PID ${server.pid}`)
}
