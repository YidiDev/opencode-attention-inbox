/** Pure release policy, shared by the CLI and negative-path tests. */
export const packageName = "opencode-attention-inbox"
export const repository = "YidiDev/opencode-attention-inbox"
const semver = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|beta|alpha)\.([1-9]\d*))?$/

export function releaseVersion(version: string) {
  const match = semver.exec(version)
  if (
    !match ||
    match[0] !== version ||
    Number(match[1]) < 1 ||
    match.slice(1, 4).some((part) => String(Number(part)) !== part)
  )
    throw new Error("Release version must be canonical SemVer >=1.0.0 (optional alpha/beta/rc.N)")
  return { version, tag: `v${version}`, distTag: match[4] ? "next" : "latest", prerelease: !!match[4] }
}

/** npm 11 uses a one-element array; npm 12 keys results by package name. */
export function parsePackResult(text: string): { filename: string; files: { path: string }[] } {
  const parsed = JSON.parse(text)
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Object.keys(parsed).length === 1
      ? [parsed[packageName]]
      : []
  const result = entries[0]
  if (
    entries.length !== 1 ||
    !result ||
    result.name !== packageName ||
    typeof result.version !== "string" ||
    result.filename !== `${packageName}-${result.version}.tgz` ||
    !Array.isArray(result.files) ||
    !result.files.every((file: unknown) => file && typeof (file as { path?: unknown }).path === "string")
  )
    throw new Error("Expected one npm pack result for the release package")
  releaseVersion(result.version)
  return { filename: result.filename, files: result.files }
}

export function validateReleaseContext(context: Record<string, string | undefined>, tag: string) {
  if (!context.GITHUB_ACTIONS) return
  if (context.GITHUB_REPOSITORY !== repository) throw new Error("Untrusted release repository")
  if (
    context.GITHUB_EVENT_NAME === "push" &&
    context.GITHUB_REF === `refs/tags/${tag}` &&
    context.GITHUB_REF_NAME === tag
  )
    return
  if (context.GITHUB_EVENT_NAME === "workflow_dispatch" && context.GITHUB_REF === "refs/heads/main") return
  throw new Error("Only an exact version-tag push or main validation dispatch is allowed")
}

export function existingVersionMatches(metadata: Record<string, unknown> | undefined, integrity: string) {
  if (!metadata) return false
  if ((metadata.dist as Record<string, unknown> | undefined)?.integrity !== integrity)
    throw new Error("Existing npm version has different bytes; never overwrite")
  return true
}

export function validateManifest(manifest: Record<string, unknown>, tag: string, changelog: string) {
  const version = releaseVersion(String(manifest.version))
  if (manifest.name !== packageName || manifest.private === true || tag !== version.tag)
    throw new Error("Package name, publishability, or tag/version mismatch")
  const config = manifest.publishConfig as Record<string, unknown> | undefined
  const repo = manifest.repository as Record<string, unknown> | undefined
  const author = manifest.author as Record<string, unknown> | undefined
  if (
    config?.access !== "public" ||
    config.registry !== "https://registry.npmjs.org/" ||
    repo?.url !== `git+https://github.com/${repository}.git` ||
    author?.name !== "YidiDev" ||
    manifest.license !== "MIT"
  )
    throw new Error("Release ownership, registry, repository or license mismatch")
  if (
    !changelog
      .split("\n")
      .some((line) => line === `## ${version.version}` || line.startsWith(`## ${version.version} — `))
  )
    throw new Error("Changelog must contain an exact heading for the release version")
  return version
}

export function validateArchivePaths(paths: string[]) {
  const seen = new Set<string>()
  for (const path of paths) {
    if (
      !/^package\/(?:dist\/|src\/|package\.json$|README\.md$|LICENSE$|NOTICE$|SECURITY\.md$|CONTRIBUTING\.md$|CHANGELOG\.md$|RELEASING\.md$|THIRD_PARTY_NOTICES\.md$)/.test(
        path,
      ) ||
      /(?:^|\/)\.{1,2}(?:\/|$)/.test(path) ||
      path.includes("\\") ||
      [...path].some((character) => character.charCodeAt(0) < 32) ||
      seen.has(path)
    )
      throw new Error("Unexpected, duplicate or unsafe archive path")
    seen.add(path)
  }
  for (const path of [
    "package.json",
    "dist/index.js",
    "dist/tui.js",
    "README.md",
    "LICENSE",
    "NOTICE",
    "CHANGELOG.md",
    "RELEASING.md",
  ])
    if (!seen.has(`package/${path}`)) throw new Error(`Required archive file missing: ${path}`)
}

export function releaseNotes(changelog: string, version: string) {
  releaseVersion(version)
  const lines = changelog.split("\n")
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} — `))
  if (start < 0) throw new Error("Release notes missing")
  let end = start + 1
  while (end < lines.length && !lines[end]?.startsWith("## ")) end++
  const notes = lines
    .slice(start + 1, end)
    .join("\n")
    .trim()
  if (!notes) throw new Error("Release notes cannot be empty")
  return notes
}
