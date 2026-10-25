/** Opt-in real-host smoke test. Uses only its own server, tmux socket and XDG directories. */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { OpenCode } from "@opencode/client"
import { build } from "./build.js"
import { packageName, parsePackResult, releaseVersion, validateArchivePaths } from "./release-policy.ts"

const arguments_ = process.argv.slice(2)
const mode = arguments_[0]
if (arguments_.length && (!(mode === "--tarball" || mode === "--package") || arguments_.length !== 2))
  throw new Error("Usage: live-smoke.ts [--tarball archive.tgz | --package opencode-attention-inbox@version]")
const registryPackage = mode === "--package" ? arguments_[1] : undefined
if (registryPackage) {
  if (!registryPackage.startsWith(`${packageName}@`)) throw new Error("Unexpected registry package")
  releaseVersion(registryPackage.slice(packageName.length + 1))
}

const root = await mkdtemp("/tmp/opencode/attention-inbox-live-").catch((error: NodeJS.ErrnoException) => {
  if (error.code !== "EACCES" && error.code !== "ENOENT") throw error
  return mkdtemp(join(tmpdir(), "opencode-attention-inbox-live-"))
})
const repo = resolve(import.meta.dir, "..")
const socket = `attention-${process.pid}`
// Explicit allowlist: do not leak provider/cloud/GitHub credentials to the host.
const env: Record<string, string> = {}
for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "LD_LIBRARY_PATH"]) {
  const value = process.env[key]
  if (value !== undefined) env[key] = value
}
env.SHELL = "/bin/bash"
Object.assign(env, {
  HOME: root,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"),
  XDG_CACHE_HOME: join(root, "cache"),
  TERM: "xterm-256color",
  OPENCODE_SERVER_PASSWORD: crypto.randomUUID(),
})
env.OPENCODE_PASSWORD = env.OPENCODE_SERVER_PASSWORD!
for (const path of [env.HOME!, join(env.XDG_CONFIG_HOME!, "opencode"), join(root, "a"), join(root, "b")]) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}
const run = async (args: string[], cwd = root) => {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
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
const pointerTarget = async (needle: string) => {
  const lines = (await capture()).split("\n")
  let row = -1
  for (let index = 0; index < lines.length; index++) if (lines[index]!.includes(needle)) row = index
  assert(row >= 0, `mouse target: ${needle}`)
  const column = Bun.stringWidth(lines[row]!.slice(0, lines[row]!.indexOf(needle))) + 1
  return { column, row }
}
const clickText = async (needle: string) => {
  const { column, row } = await pointerTarget(needle)
  await tmux("send-keys", "-t", "inbox", "-l", `\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`)
}
const save = async (name: string) => {
  const text = await capture()
  const safe = text.replaceAll(root, "<fixture>").replaceAll(env.OPENCODE_PASSWORD!, "<redacted>")
  await writeFile(join(root, `${name}.txt`), safe)
  if (process.env.INBOX_LIVE_EVIDENCE_DIR) {
    await mkdir(process.env.INBOX_LIVE_EVIDENCE_DIR, { recursive: true })
    await writeFile(join(process.env.INBOX_LIVE_EVIDENCE_DIR, `${name}.txt`), safe)
  }
  return text
}
const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(label)
}
let archive: string | undefined
if (!registryPackage) {
  if (mode === "--tarball") archive = resolve(arguments_[1]!)
  else {
    await build()
    const packed = parsePackResult(
      await run(["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", root], repo),
    )
    archive = join(root, packed.filename)
  }
  validateArchivePaths((await run(["tar", "-tzf", archive])).trim().split("\n"))
}
// Release mode installs the exact tested archive; registry mode exercises the
// host's real package resolver with an empty HOME/config/cache.
const installed = join(root, "node_modules", "opencode-attention-inbox")
if (mode === "--tarball") {
  await writeFile(join(root, "package.json"), JSON.stringify({ private: true, type: "module" }))
  await run(["bun", "add", "--ignore-scripts", archive!])
} else if (archive) {
  await mkdir(installed, { recursive: true })
  await run(["tar", "-xzf", archive, "--strip-components=1", "-C", installed])
}
const config = {
  $schema: "https://opencode.ai/v2/cli.json",
  highlights: false,
  animations: false,
  attention: { notifications: false, sound: false },
  tabs: { mode: "on", scope: "global" },
  plugins: [{ package: registryPackage ?? join(installed, "dist"), options: { pollIntervalMs: 5000 } }],
}
await writeFile(join(env.XDG_CONFIG_HOME!, "opencode", "cli.json"), JSON.stringify(config))
for (const name of ["a", "b"]) {
  const cwd = join(root, name)
  await run(["git", "init", "-q", "--initial-branch=master"], cwd)
  await run(
    [
      "git",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      name,
    ],
    cwd,
  )
}
await run(["git", "worktree", "add", "-qb", "fixture-tree", join(root, "tree")], join(root, "a"))
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const port = reservation.port!
reservation.stop(true)
const url = `http://127.0.0.1:${port}`
const startServer = () =>
  Bun.spawn(["opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    env,
    cwd: root,
    stdout: Bun.file(join(root, "server.stdout")),
    stderr: Bun.file(join(root, "server.stderr")),
  })
let server = startServer()
let failed = false
try {
  const client = OpenCode.make({
    baseUrl: url,
    headers: {
      authorization: `Basic ${Buffer.from(`opencode:${env.OPENCODE_PASSWORD}`).toString("base64")}`,
    },
  })
  await wait(async () => !!(await client.server.info()), "private server startup")
  const primary = await client.session.create({
    title: "Fixture primary",
    location: { directory: join(root, "a") },
  })
  const other = await client.session.create({
    title: "Fixture foreign question",
    location: { directory: join(root, "b") },
  })
  const tree = await client.session.create({
    title: "Fixture worktree question",
    location: { directory: join(root, "tree") },
  })
  const done = await client.session.create({
    title: "Fixture completed",
    location: { directory: join(root, "a") },
  })
  // Import native metadata through the supported API: no model call or store edits.
  await client.session.remove({ sessionID: done.id })
  const imported = await client.session.import({
    info: { ...done, outcome: "succeeded", time: { ...done.time, idle: Date.now() } },
    messages: [],
    location: done.location,
  })
  assert(
    imported.projectID === primary.projectID &&
      imported.outcome === "succeeded" &&
      imported.time.idle! > (imported.time.viewed ?? 0),
    "imported native completion fixture",
  )
  const archived = await client.session.create({
    title: "Fixture archived",
    location: { directory: join(root, "b") },
  })
  await client.session.update({ sessionID: archived.id, archived: true })
  assert(
    (await client.session.list({ limit: 100 })).data.some((session) => session.id === archived.id),
    "unfiltered inventory includes archives",
  )
  assert(
    primary.projectID === tree.projectID && primary.projectID !== other.projectID,
    "fixture projects/worktree identity",
  )
  const makeForm = (sessionID: string) =>
    client.session.form.create({
      sessionID,
      title: "Fixture question",
      fields: [{ key: "answer", type: "string", title: "Fixture answer" }],
    })
  const foreignForm = await makeForm(other.id)
  await makeForm(tree.id)
  await client.session.update({
    sessionID: other.id,
    permissions: [{ action: "fixture", resource: "*", effect: "ask" }],
  })
  const permissionEffect = client.permission
    .create({ sessionID: other.id, action: "fixture", resources: ["fixture"] })
    .catch(() => undefined)
  await wait(
    async () => (await client.permission.list({ sessionID: other.id })).length === 1,
    "native permission fixture",
  )
  const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
  const command = [
    "env",
    "-i",
    ...Object.entries(env).map(([key, value]) => `${key}=${value}`),
    "opencode",
    "--server",
    url,
    "--session",
    primary.id,
    join(root, "a"),
  ]
    .map(shellQuote)
    .join(" ")
  await tmux("new-session", "-d", "-s", "inbox", "-x", "160", "-y", "48", command)
  await wait(
    async () => (await capture()).includes("Fixture worktree question"),
    "worktree included in project",
  )
  await wait(async () => (await capture()).includes("● Fixture completed"), "native completion indicator")
  let screen = await save("01-project")
  assert(!screen.includes("Fixture foreign question"), "foreign project must be filtered")
  assert(!screen.includes("Needs attention"), "sidebar has no permanent header")
  await tmux("send-keys", "-t", "inbox", "C-x", "v")
  await wait(async () => (await capture()).includes("Fixture foreign question"), "all-project inventory")
  await wait(
    async () => (await capture()).includes("!? Fixture foreign question"),
    "multiple compact request indicators",
  )
  const target = await pointerTarget("Fixture foreign question")
  const plainBefore = (await capture()).split("\n")[target.row]
  const colorBefore = (await tmux("capture-pane", "-p", "-e", "-t", "inbox:0.0")).split("\n")[target.row]
  await tmux("send-keys", "-t", "inbox", "-l", `\x1b[<35;${target.column};${target.row + 1}M`)
  await wait(
    async () =>
      (await tmux("capture-pane", "-p", "-e", "-t", "inbox:0.0")).split("\n")[target.row] !== colorBefore,
    "hover highlights without extra status lines",
  )
  const hoveredScreen = await save("02-hover")
  assert(!hoveredScreen.includes("› !?"), "hover never focuses the inbox")
  assert(hoveredScreen.split("\n")[target.row] === plainBefore, "hover never shifts or renames the row")
  const colorAfter = (await tmux("capture-pane", "-p", "-e", "-t", "inbox:0.0")).split("\n")[target.row]
  assert(colorAfter !== colorBefore, "native theme visibly highlights the hovered row")
  await tmux("send-keys", "-t", "inbox", "C-x", "v")
  await wait(async () => !(await capture()).includes("Fixture foreign question"), "scope keyboard shortcut")
  await tmux("send-keys", "-t", "inbox", "C-x", "v")
  await wait(async () => (await capture()).includes("Fixture foreign question"), "scope keyboard toggle back")
  await save("02-all")
  // An independently started CLI must read the saved scope, without duplicating state.
  await tmux("new-session", "-d", "-s", "observer", "-x", "160", "-y", "48", command)
  const observer = () => tmux("capture-pane", "-p", "-t", "observer:0.0")
  await wait(
    async () => (await observer()).includes("Fixture foreign question"),
    "scope persists into another CLI",
  )
  await tmux("send-keys", "-t", "observer", "C-x", "v")
  await wait(
    async () => !(await capture()).includes("Fixture foreign question"),
    "scope propagates between running CLIs",
  )
  await tmux("send-keys", "-t", "inbox", "C-x", "v")
  await wait(
    async () => (await observer()).includes("Fixture foreign question"),
    "scope propagates back to the observer",
  )
  assert(
    (await client.session.get({ sessionID: done.id })).time.viewed === undefined,
    "listing in two CLIs does not acknowledge completion",
  )
  await tmux("kill-session", "-t", "observer")
  await client.session.form.cancel({ sessionID: other.id, formID: foreignForm.id })
  const permissions = await client.permission.list({ sessionID: other.id })
  await client.permission.reply({ sessionID: other.id, requestID: permissions[0]!.id, decision: "once" })
  await permissionEffect
  await wait(
    async () => !(await capture()).includes("Fixture foreign question"),
    "foreign request resolved live",
  )
  await save("03-resolved")
  // Acknowledgment in another client must clear the native completion remotely.
  const completed = await client.session.get({ sessionID: done.id })
  await client.session.view({ sessionID: done.id, idle: completed.time.idle! })
  await wait(async () => !(await capture()).includes("Fixture completed"), "another client viewed completion")
  // Focus and escape must not submit or approve anything; ordinary prompt typing resumes.
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("› ?"), "inbox focus")
  await tmux("send-keys", "-t", "inbox", "Escape")
  await wait(async () => !(await capture()).includes("› ?"), "inbox blur")
  await tmux("send-keys", "-t", "inbox", "-l", "fixture-unsent")
  await wait(async () => (await capture()).includes("fixture-unsent"), "prompt focus restored")
  await tmux("send-keys", "-t", "inbox", "C-u")
  await save("04-focus")
  // Select the owning worktree session, not a session in the launch directory.
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("› ?"), "inbox refocus")
  await tmux("send-keys", "-t", "inbox", "Enter")
  await wait(async () => (await capture()).includes("Fixture answer"), "navigate to native form")
  screen = await save("05-navigation")
  assert(
    (await client.session.form.list({ sessionID: tree.id })).length === 1,
    "opening must not answer a question",
  )
  await wait(async () => (await capture()).includes("? Fixture worktree question"), "rows survive navigation")
  const secondForeignForm = await makeForm(other.id)
  await wait(
    async () => (await capture()).includes("Fixture foreign question"),
    "live request after navigation",
  )
  await clickText("Fixture foreign question")
  await wait(
    async () => (await capture()).includes("~/b:master"),
    "mouse navigation preserves foreign location",
  )
  assert(
    (await client.session.form.list({ sessionID: other.id })).length === 1,
    "clicking must not answer a question",
  )
  await save("06-mouse")
  await client.session.form.cancel({ sessionID: other.id, formID: secondForeignForm.id })
  await wait(async () => !(await capture()).includes("Fixture answer"), "native form resolved externally")
  await tmux("resize-window", "-t", "inbox", "-x", "90", "-y", "28")
  await wait(async () => !(await capture()).includes("? Fixture worktree question"), "narrow sidebar hidden")
  await wait(async () => (await capture()).includes("Build ·"), "narrow prompt ready")
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("Needs attention"), "narrow native picker")
  await save("07-narrow-picker")
  // Native picker options remain live while open (not a one-time captured array).
  const livePickerSession = await client.session.create({
    title: "Fixture picker live",
    location: { directory: join(root, "b") },
  })
  const pickerForm = await makeForm(livePickerSession.id)
  await wait(
    async () => (await capture()).includes("Fixture picker live"),
    "open picker receives a new request",
  )
  await client.session.form.cancel({ sessionID: livePickerSession.id, formID: pickerForm.id })
  await wait(
    async () => !(await capture()).includes("Fixture picker live"),
    "open picker drops resolved request",
  )
  await tmux("send-keys", "-t", "inbox", "Escape")
  await tmux("resize-window", "-t", "inbox", "-x", "160", "-y", "48")
  await wait(
    async () =>
      (await capture()).includes("? Fixture worktree question") && (await capture()).includes("Build ·"),
    "wide layout returns",
  )
  const clicked = await client.session.create({
    title: "Fixture clicked completion",
    location: { directory: join(root, "b") },
  })
  await client.session.remove({ sessionID: clicked.id })
  const clickedIdle = Date.now()
  await client.session.import({
    info: { ...clicked, outcome: "succeeded", time: { ...clicked.time, idle: clickedIdle } },
    messages: [],
    location: clicked.location,
  })
  await wait(async () => (await capture()).includes("Fixture clicked completion"), "click completion appears")
  await clickText("Fixture clicked completion")
  await wait(
    async () => (await client.session.get({ sessionID: clicked.id })).time.viewed === clickedIdle,
    "opening completion acknowledges exact native idle",
  )
  await wait(
    async () => !(await capture()).includes("● Fixture clicked completion"),
    "viewed completion leaves footer",
  )
  await save("08-click-completion")
  // Reload owns cleanup and must restore exactly one working widget and bindings.
  await tmux("send-keys", "-t", "inbox", "Escape", "C-u")
  await tmux("send-keys", "-t", "inbox", "-l", "/reload")
  await wait(async () => (await capture()).includes("/reload"), "reload command entered")
  await tmux("send-keys", "-t", "inbox", "Enter")
  await wait(async () => !(await capture()).includes("/reload"), "reload command consumed")
  await wait(async () => {
    const text = await capture()
    return text.includes("Configuration reloaded") && !text.includes("Reloading configuration")
  }, "native configuration reload finishes")
  // Directly-created synthetic forms can be cancelled by the host's reload
  // lifecycle. Re-seed only our fixture if needed, in the other project from
  // the active completion tab: seeing it still proves saved all-project scope.
  if (!(await client.session.form.list({ sessionID: tree.id })).length) await makeForm(tree.id)
  await wait(async () => {
    const text = await capture()
    return (
      text.split("\n").slice(2).join("\n").includes("? Fixture worktree question") && text.includes("Build ·")
    )
  }, "reload restores saved scope")
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("› ?"), "focus still works after reload")
  assert(
    // The native top tab may display the same question indicator/title. It is
    // not a second inbox row; inspect the body below the tab strip.
    (await capture()).split("\n").slice(2).join("\n").split("? Fixture worktree question").length === 2,
    "reload must not duplicate rows",
  )
  await save("09-reload")
  await tmux("send-keys", "-t", "inbox", "Escape")
  await wait(async () => !(await capture()).includes("› ?"), "release focus before disabling tabs")
  await writeFile(
    join(env.XDG_CONFIG_HOME!, "opencode", "cli.json"),
    JSON.stringify({ ...config, tabs: { mode: "off", scope: "global" } }),
  )
  await wait(async () => {
    const text = await capture()
    return (
      !text.split("\n")[0]?.includes("Fixture primary") &&
      text.includes("Configuration reloaded") &&
      !text.includes("Reloading configuration")
    )
  }, "tabs-disabled configuration reload finishes")
  const noTabsForm = await makeForm(other.id)
  await wait(
    async () => (await capture()).includes("? Fixture foreign question"),
    "root request appears with tabs off",
  )
  await clickText("Fixture foreign question")
  await wait(
    async () => (await capture()).includes("Fixture answer"),
    "tabs-disabled root navigation opens form",
  )
  await client.session.form.cancel({ sessionID: other.id, formID: noTabsForm.id })
  await wait(async () => !(await capture()).includes("Fixture answer"), "tabs-disabled root form cancelled")
  const child = await client.session.create({
    title: "Fixture child blocker",
    parentID: other.id,
    location: other.location,
  })
  const childForm = await makeForm(child.id)
  await wait(
    async () => (await capture()).includes("Fixture child blocker"),
    "child blocker appears with tabs off",
  )
  await clickText("Fixture child blocker")
  // Public child routing opens the native Subagents panel, not a root tab.
  // Synthetic children are inactive and use the host's show-inactive control.
  await wait(async () => (await capture()).includes("Subagents"), "child route opens native subagent panel")
  await tmux("send-keys", "-t", "inbox", "C-a")
  await wait(
    async () => (await capture()).includes("Fixture child blocker"),
    "native panel includes inactive child",
  )
  assert(
    (await client.session.form.list({ sessionID: child.id })).length === 1,
    "child navigation never answers",
  )
  await save("10-child-tabs-off")
  await client.session.form.cancel({ sessionID: child.id, formID: childForm.id })
  await tmux("send-keys", "-t", "inbox", "Escape")
  await wait(async () => !(await capture()).includes("Subagents  Shell"), "return from child panel")
  const scrollForms: { sessionID: string; formID: string; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const label = String(i).padStart(2, "0")
    const owner = await client.session.create({ title: `Fixture scroll ${label}`, location: other.location })
    const form = await client.session.form.create({
      sessionID: owner.id,
      title: `Scroll form ${label}`,
      fields: [{ key: "answer", type: "string", title: `Scroll answer ${label}` }],
    })
    scrollForms.push({ sessionID: owner.id, formID: form.id, label })
  }
  await wait(async () => {
    const text = await capture()
    return text.includes("Fixture scroll 00") && !text.includes("Stale") && !text.includes("Partial")
  }, "all scroll fixtures finish reconciliation")
  const beforeScroll = await capture()
  const heading = beforeScroll.split("\n").findIndex((line) => line.includes("Fixture scroll"))
  const column = beforeScroll.split("\n")[heading]!.indexOf("Fixture scroll") + 1
  const firstVisible = (text: string) => text.match(/Fixture scroll (\d+)/)?.[1]
  const first = firstVisible(beforeScroll)
  for (let i = 0; i < 8; i++) {
    await tmux("send-keys", "-t", "inbox", "-l", `\x1b[<65;${column};${heading + 1}M`)
  }
  let clickedLabel: string | undefined
  let stableFrames = 0
  await wait(async () => {
    const candidate = firstVisible(await capture())
    if (candidate === undefined || candidate === first) {
      stableFrames = 0
      return false
    }
    stableFrames = candidate === clickedLabel ? stableFrames + 1 : 1
    clickedLabel = candidate
    return stableFrames >= 4
  }, "native wheel settles on a different visible row")
  assert(clickedLabel !== undefined, "scrolled row remains visible")
  await clickText(`Fixture scroll ${clickedLabel}`)
  await wait(
    async () => (await capture()).includes(`Scroll answer ${clickedLabel}`),
    "scrolled click opens the exact owning form",
  )
  const selectedForm = scrollForms.find((item) => item.label === clickedLabel)!
  assert(
    (await client.session.form.list({ sessionID: selectedForm.sessionID })).length === 1,
    "scrolled navigation never answers",
  )
  await save("11-scroll-click")
  for (const item of scrollForms) await client.session.form.cancel(item)
  const shortOwner = await client.session.create({
    title: "Fixture short terminal",
    location: other.location,
  })
  const shortForm = await makeForm(shortOwner.id)
  await wait(
    async () => (await capture()).includes("Fixture short terminal"),
    "short-terminal request is indexed",
  )
  await tmux("resize-window", "-t", "inbox", "-x", "90", "-y", "18")
  await wait(
    async () =>
      (await capture()).includes("Build ·") && !(await capture()).includes("? Fixture short terminal"),
    "short terminal prompt remains usable",
  )
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("Needs attention"), "short terminal picker")
  await save("12-short-picker")
  await tmux("send-keys", "-t", "inbox", "Escape")
  await wait(async () => !(await capture()).includes("Needs attention"), "short picker closes")
  await tmux("resize-window", "-t", "inbox", "-x", "160", "-y", "48")
  await wait(async () => (await capture()).includes("? Fixture short terminal"), "wide attention row returns")
  await client.session.form.cancel({ sessionID: shortOwner.id, formID: shortForm.id })
  // Native Escape may already have cancelled this fixture while navigating.
  for (const form of await client.session.form.list({ sessionID: tree.id })) {
    await client.session.form.cancel({ sessionID: tree.id, formID: form.id })
  }
  await wait(async () => {
    const text = await capture()
    return !/\? Fixture/.test(text) && !text.includes("Partial") && !text.includes("Stale")
  }, "last attention row disappears")
  const emptyScreen = await save("13-empty")
  assert(!emptyScreen.includes("Needs attention"), "empty inbox leaves no heading")
  assert(!emptyScreen.includes("Nothing needs attention"), "empty inbox leaves no empty message")
  assert(!emptyScreen.includes("All projects"), "empty inbox leaves no scope control")
  // Restart only this harness's authenticated server; inventory must recover on reconnect.
  server.kill()
  await server.exited
  server = startServer()
  await wait(async () => !!(await client.server.info()), "private server restart")
  const recovered = await client.session.create({
    title: "Fixture after reconnect",
    location: other.location,
  })
  const recoveredForm = await makeForm(recovered.id)
  await tmux("resize-window", "-t", "inbox", "-x", "160", "-y", "48")
  await wait(
    async () => (await capture()).includes("Fixture after reconnect"),
    "attention recovers after server reconnect",
  )
  await tmux("send-keys", "-t", "inbox", "C-x", "o")
  await wait(async () => (await capture()).includes("› ?"), "remounted inbox accepts keyboard focus")
  await client.session.form.cancel({ sessionID: recovered.id, formID: recoveredForm.id })
  await wait(
    async () => !(await capture()).includes("Fixture after reconnect"),
    "reconnected request resolves live",
  )
  await tmux("send-keys", "-t", "inbox", "-l", "fixture-after-empty")
  await wait(async () => (await capture()).includes("fixture-after-empty"), "last row restores prompt focus")
  await tmux("send-keys", "-t", "inbox", "C-u")
  await save("14-reconnect")
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
