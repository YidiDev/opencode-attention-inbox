/** Install only a checksum-verified official Linux x64 binary, without package scripts. */
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import artifact from "./host-artifact.json"

if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Host fixture requires Linux x64")
let spec = artifact
if (process.argv.includes("--latest")) {
  // Scheduled compatibility probe only; never changes the checked-in support pin.
  const response = await fetch("https://registry.npmjs.org/@opencode%2fcli-linux-x64-baseline/latest", {
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) throw new Error("Could not discover latest host")
  const meta = (await response.json()) as { version: string; dist: { tarball: string; integrity: string } }
  spec = { version: meta.version, url: meta.dist.tarball, integrity: meta.dist.integrity }
}
if (
  !spec.url.startsWith("https://registry.npmjs.org/@opencode/cli-linux-x64-baseline/-/") ||
  !spec.integrity.startsWith("sha512-")
) {
  throw new Error("Unexpected host artifact")
}
const response = await fetch(spec.url, { signal: AbortSignal.timeout(120_000) })
if (!response.ok) throw new Error("Could not download host artifact")
const archive = new Uint8Array(await response.arrayBuffer())
if (`sha512-${createHash("sha512").update(archive).digest("base64")}` !== spec.integrity)
  throw new Error("Host integrity mismatch")
const temporary = await mkdtemp(join(tmpdir(), "inbox-host-"))
const output = resolve(process.env.INBOX_HOST_BIN_DIR ?? join(temporary, "bin"))
try {
  const tarball = join(temporary, "host.tgz")
  await writeFile(tarball, archive)
  await mkdir(output, { recursive: true })
  const child = Bun.spawn(
    ["tar", "-xzf", tarball, "--strip-components=2", "-C", output, "package/bin/opencode"],
    { stdout: "inherit", stderr: "inherit" },
  )
  if (await child.exited) throw new Error("Could not extract host")
  const executable = join(output, "opencode")
  await chmod(executable, 0o755)
  console.log(`Installed OpenCode ${spec.version} in ${output}`)
} finally {
  // Keep a default output inside temporary/bin, otherwise remove only our archive directory.
  if (process.env.INBOX_HOST_BIN_DIR) await rm(temporary, { recursive: true, force: true })
}
