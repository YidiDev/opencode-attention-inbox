import { describe, expect, test } from "bun:test"
import {
  existingVersionMatches,
  packageName,
  parsePackResult,
  releaseNotes,
  releaseVersion,
  validateArchivePaths,
  validateManifest,
  validateReleaseContext,
} from "../scripts/release-policy.ts"

const manifest = {
  name: packageName,
  version: "1.0.0",
  author: { name: "YidiDev" },
  license: "MIT",
  repository: { url: "git+https://github.com/YidiDev/opencode-attention-inbox.git" },
  publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
}
const required = [
  "package.json",
  "dist/index.js",
  "dist/tui.js",
  "README.md",
  "LICENSE",
  "NOTICE",
  "CHANGELOG.md",
  "RELEASING.md",
].map((path) => `package/${path}`)
describe("release policy", () => {
  test("npm 11 and 12 pack output identify exactly one safe release archive", () => {
    const result = {
      name: packageName,
      version: "1.0.0-rc.2",
      filename: `${packageName}-1.0.0-rc.2.tgz`,
      files: [{ path: "package.json" }],
    }
    for (const shape of [[result], { [packageName]: result }])
      expect(parsePackResult(JSON.stringify(shape))).toEqual({
        filename: result.filename,
        files: result.files,
      })
    for (const invalid of [
      null,
      [],
      [result, result],
      { other: result },
      { [packageName]: result, other: result },
      [{ ...result, name: "other" }],
      [{ ...result, filename: "../archive.tgz" }],
      [{ ...result, version: "1.0.0-rc.02" }],
      [{ ...result, files: [null] }],
      [{ ...result, files: [{ path: 123 }] }],
    ])
      expect(() => parsePackResult(JSON.stringify(invalid))).toThrow()
  })
  test("forks, PRs, arbitrary branches and tag/version mismatches cannot release", () => {
    const context = {
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "YidiDev/opencode-attention-inbox",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/tags/v1.0.0",
      GITHUB_REF_NAME: "v1.0.0",
    }
    expect(() => validateReleaseContext(context, "v1.0.0")).not.toThrow()
    expect(() => validateReleaseContext({}, "v1.0.0")).not.toThrow()
    expect(() =>
      validateReleaseContext(
        { ...context, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main" },
        "v1.0.0",
      ),
    ).not.toThrow()
    for (const invalid of [
      { ...context, GITHUB_REPOSITORY: "fork/repo" },
      { ...context, GITHUB_EVENT_NAME: "pull_request" },
      { ...context, GITHUB_REF: "refs/heads/main" },
      { ...context, GITHUB_REF_NAME: "v2.0.0" },
      { ...context, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/feature" },
    ])
      expect(() => validateReleaseContext(invalid, "v1.0.0")).toThrow()
  })
  test("retry accepts only identical already-published bytes, never a conflicting version", () => {
    expect(existingVersionMatches(undefined, "sha512-expected")).toBe(false)
    expect(existingVersionMatches({ dist: { integrity: "sha512-expected" } }, "sha512-expected")).toBe(true)
    expect(() => existingVersionMatches({ dist: { integrity: "sha512-other" } }, "sha512-expected")).toThrow()
    expect(() => existingVersionMatches({}, "sha512-expected")).toThrow()
  })
  test("stable and prerelease channels cannot be confused", () => {
    expect(releaseVersion("1.0.0")).toEqual({
      version: "1.0.0",
      tag: "v1.0.0",
      distTag: "latest",
      prerelease: false,
    })
    for (const version of ["1.0.0-rc.1", "1.2.0-beta.2", "2.0.0-alpha.1"])
      expect(releaseVersion(version)).toMatchObject({ distTag: "next", prerelease: true })
    for (const version of [
      "0.1.0",
      "v1.0.0",
      "01.0.0",
      "1.01.0",
      "1.0.00",
      "1.0.0-rc.0",
      "1.0.0-rc.01",
      "1.0.0+build",
      "1.0",
      "1.0.0\n",
      "1.0.0;echo bad",
    ])
      expect(() => releaseVersion(version)).toThrow()
  })
  test("release must agree with version, changelog, owner and public registry", () => {
    expect(validateManifest(manifest, "v1.0.0", "## 1.0.0\n\n- First release")).toMatchObject({
      version: "1.0.0",
    })
    for (const invalid of [
      { ...manifest, private: true },
      { ...manifest, name: "other" },
      { ...manifest, author: { name: "other" } },
      { ...manifest, license: "other" },
      { ...manifest, repository: { url: "https://example.com" } },
      { ...manifest, publishConfig: { access: "restricted", registry: "https://registry.npmjs.org/" } },
      { ...manifest, publishConfig: { access: "public", registry: "https://example.com" } },
    ])
      expect(() => validateManifest(invalid, "v1.0.0", "## 1.0.0")).toThrow()
    expect(() => validateManifest(manifest, "v1.0.1", "## 1.0.0")).toThrow()
    expect(() => validateManifest(manifest, "v1.0.0", "## 1.0.01")).toThrow()
  })
  test("archive allowlist rejects traversal, duplicates and development/private files", () => {
    expect(() =>
      validateArchivePaths([...required, "package/dist/ui/inbox.js", "package/src/tui.tsx"]),
    ).not.toThrow()
    for (const bad of [
      "../secret",
      "package/dist/../../secret",
      "package/dist/./x",
      "package/.npmrc",
      "package/.git/config",
      "package/tests/a.ts",
      "package/scripts/a.ts",
      "package/dist/x\\y",
      "package/dist/a\nx",
    ])
      expect(() => validateArchivePaths([...required, bad])).toThrow()
    expect(() => validateArchivePaths([...required, required[0]!])).toThrow()
    expect(() => validateArchivePaths(required.slice(1))).toThrow()
  })
  test("notes use the exact release section, not inherited upstream history", () => {
    const text =
      "# Changelog\n## Unreleased\n- Future\n## 1.0.0 — 2026-10-25\n\n- First stable\n\n## 0.1.0\n- Old"
    expect(releaseNotes(text, "1.0.0")).toBe("- First stable")
    expect(() => releaseNotes(text, "1.0.1")).toThrow()
    expect(() => releaseNotes("## 1.0.0\n\n## 0.1.0", "1.0.0")).toThrow()
  })
  test("publish privileges are job-local, dispatch cannot publish, dependencies are not installed in publisher", async () => {
    const workflow = await Bun.file(new URL("../.github/workflows/release.yml", import.meta.url)).text()
    expect(workflow).not.toContain("NPM_TOKEN")
    expect(workflow).not.toContain("pull_request_target")
    expect(workflow).toContain("cancel-in-progress: false")
    expect(workflow).toContain("github.event_name == 'push' && needs.validate.outputs.exists == 'true'")
    const publisher = workflow.split("  publish:\n")[1]!.split("  registry-smoke:\n")[0]!
    expect(publisher).toContain("id-token: write")
    expect(publisher).toContain("environment: npm")
    expect(publisher).not.toContain("bun install")
    expect(publisher).not.toContain("contents: write")
    expect(workflow).toContain("--tarball")
    expect(workflow).toContain("--package")
    const script = await Bun.file(new URL("../scripts/release.ts", import.meta.url)).text()
    expect(script).toContain('"--json"')
    expect(script).toContain('"--provenance"')
    expect(script).toContain("result.filename !== data.filename")
  })
})
