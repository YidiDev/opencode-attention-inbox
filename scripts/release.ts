/** No dependencies/lifecycle hooks: executable under pinned Node 24 or Bun. */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  existingVersionMatches,
  packageName,
  releaseNotes,
  releaseVersion,
  validateArchivePaths,
  validateManifest,
  validateReleaseContext,
} from "./release-policy.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const output = join(root, ".release")
const registry = "https://registry.npmjs.org"
type Artifact = {
  version: string
  tag: string
  distTag: string
  prerelease: boolean
  commit: string
  filename: string
  sha256: string
  integrity: string
}
const hash = (bytes: Uint8Array, algorithm: string, encoding: "hex" | "base64") =>
  createHash(algorithm).update(bytes).digest(encoding)
function run(command: string, args: string[]) {
  const child = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (child.error || child.status !== 0)
    throw new Error(`${command} failed: ${child.error?.message ?? child.stderr}`)
  return child.stdout.trim()
}
async function json(url: string): Promise<Record<string, unknown> | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`)
  return (await response.json()) as Record<string, unknown>
}
async function inspect(path: string) {
  const listing = run("tar", ["-tzf", path]).split("\n")
  validateArchivePaths(listing)
  if (
    run("tar", ["-tvzf", path])
      .split("\n")
      .some((line) => !line.startsWith("-") && !line.startsWith("d"))
  )
    throw new Error("Archive must not contain links or special files")
  return JSON.parse(run("tar", ["-xOzf", path, "package/package.json"])) as Record<string, unknown>
}
async function artifact() {
  const data = JSON.parse(await readFile(join(output, "release.json"), "utf8")) as Artifact
  const version = releaseVersion(data.version)
  if (
    data.filename !== `${packageName}-${data.version}.tgz` ||
    basename(data.filename) !== data.filename ||
    data.tag !== version.tag ||
    data.distTag !== version.distTag ||
    data.prerelease !== version.prerelease
  )
    throw new Error("Invalid release artifact metadata")
  const path = join(output, data.filename)
  const bytes = await readFile(path)
  if (
    hash(bytes, "sha256", "hex") !== data.sha256 ||
    `sha512-${hash(bytes, "sha512", "base64")}` !== data.integrity
  )
    throw new Error("Release archive integrity mismatch")
  const manifest = await inspect(path)
  validateManifest(manifest, data.tag, await readFile(join(root, "CHANGELOG.md"), "utf8"))
  if (data.commit !== run("git", ["rev-parse", "HEAD"]))
    throw new Error("Release artifact belongs to another commit")
  return { data, path }
}
async function validateRef() {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
  const tag =
    process.env.GITHUB_EVENT_NAME === "push" ? (process.env.GITHUB_REF_NAME ?? "") : `v${manifest.version}`
  const version = validateManifest(manifest, tag, await readFile(join(root, "CHANGELOG.md"), "utf8"))
  validateReleaseContext(process.env, version.tag)
  if (process.env.GITHUB_ACTIONS) {
    run("git", ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"])
  }
  for (const notice of ["Copyright (c) 2026 YidiDev", "Copyright (c) 2026 Yash Patel"])
    if (!(await readFile(join(root, "LICENSE"), "utf8")).includes(notice))
      throw new Error("Copyright notice missing")
  return version
}
async function pack() {
  const version = await validateRef()
  await mkdir(output, { recursive: true })
  const packed = JSON.parse(
    run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", output]),
  ) as { filename: string }[]
  const filename = packed[0]?.filename
  if (filename !== `${packageName}-${version.version}.tgz`) throw new Error("Unexpected packed filename")
  const path = join(output, filename)
  validateManifest(await inspect(path), version.tag, await readFile(join(root, "CHANGELOG.md"), "utf8"))
  const bytes = await readFile(path)
  const data: Artifact = {
    ...version,
    filename,
    commit: run("git", ["rev-parse", "HEAD"]),
    sha256: hash(bytes, "sha256", "hex"),
    integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
  }
  await writeFile(join(output, "release.json"), `${JSON.stringify(data, null, 2)}\n`)
  await writeFile(join(output, "SHA256SUMS"), `${data.sha256}  ${filename}\n`)
  await writeFile(
    join(output, "notes.md"),
    `${releaseNotes(await readFile(join(root, "CHANGELOG.md"), "utf8"), data.version)}\n\nSupported baseline: OpenCode 2.1.4, Linux x64. Install in global cli.json as ${packageName}@${data.version}.\n`,
  )
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `version=${data.version}\ntag=${data.tag}\nprerelease=${data.prerelease}\nfilename=${filename}\n`,
    )
  console.log(`Packed ${filename} (${data.integrity})`)
}
async function publish() {
  await validateRef()
  if (process.env.GITHUB_EVENT_NAME !== "push") throw new Error("Only a version-tag push may publish")
  const { data, path } = await artifact()
  const existing = await json(`${registry}/${packageName}/${data.version}`)
  if (existingVersionMatches(existing, data.integrity)) {
    console.log("Identical npm version already exists; continuing verification without republishing")
    return
  }
  run("npm", ["publish", path, "--ignore-scripts", "--access", "public", "--tag", data.distTag])
}
async function verify() {
  const { data } = await artifact()
  for (let attempt = 0; attempt < 15; attempt++) {
    const meta = await json(`${registry}/${packageName}/${data.version}`)
    const dist = meta?.dist as { integrity?: string; tarball?: string } | undefined
    if (meta && dist?.integrity !== data.integrity)
      throw new Error("Registry version integrity does not match tested archive")
    if (dist?.tarball) {
      if (dist.tarball !== `${registry}/${packageName}/-/${data.filename}`)
        throw new Error("Unexpected registry tarball URL")
      const response = await fetch(dist.tarball, { signal: AbortSignal.timeout(30_000), redirect: "error" })
      if (!response.ok) throw new Error("Registry tarball download failed")
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (hash(bytes, "sha256", "hex") !== data.sha256)
        throw new Error("Published bytes differ from tested bytes")
      const info = await json(`${registry}/${packageName}`)
      if ((info?.["dist-tags"] as Record<string, string> | undefined)?.[data.distTag] !== data.version)
        throw new Error("Registry distribution tag does not match release")
      console.log(`Verified registry bytes and ${data.distTag} for ${data.version}`)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error("Registry version did not become available")
}
export async function main(command: string | undefined) {
  if (command === "pack") return pack()
  if (command === "inspect") return artifact()
  if (command === "publish") return publish()
  if (command === "verify") return verify()
  if (command === "registry") {
    const exists = !!(await json(`${registry}/${packageName}`))
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `exists=${exists}\n`)
    console.log(
      exists
        ? "Package exists; trusted publishing can be configured"
        : "First-package bootstrap required; see RELEASING.md",
    )
    return
  }
  throw new Error("Expected pack, inspect, registry, publish or verify")
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv[2])
