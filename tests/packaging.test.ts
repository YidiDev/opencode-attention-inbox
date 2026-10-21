import { expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { build } from "../scripts/build.js"

const repo = join(import.meta.dir, "..")
const files = async (root: string, prefix = ""): Promise<string[]> => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(root, join(prefix, entry.name)) : [join(prefix, entry.name)]))).flat().sort()
}

test("committed universal build matches source and keeps host runtimes external", async () => {
  const out = await mkdtemp(join(tmpdir(), "attention-inbox-build-"))
  try {
    await build(out)
    const expected = await files(join(repo, "dist"))
    expect(await files(out)).toEqual(expected)
    for (const file of expected) expect(await readFile(join(out, file), "utf8")).toBe(await readFile(join(repo, "dist", file), "utf8"))
    const tui = await readFile(join(out, "tui.js"), "utf8")
    const inbox = await readFile(join(out, "ui/inbox.js"), "utf8")
    expect(tui).toContain('from "@opentui/solid"')
    expect(tui).toContain("get rows()")
    expect(inbox).toContain('from "solid-js"')
    expect(inbox).not.toContain("jsx-runtime")
  } finally { await rm(out, { recursive: true, force: true }) }
})

test("npm archive includes entrypoints, attribution and no development artifacts", async () => {
  const child = Bun.spawn(["npm", "pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: repo, stdout: "pipe", stderr: "pipe" })
  const [text, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(code, stderr).toBe(0)
  const packed = JSON.parse(text) as { files: { path: string }[] }[]
  const paths = packed[0]!.files.map(file => file.path)
  for (const path of ["dist/index.js", "dist/tui.js", "dist/ui/inbox.js", "README.md", "LICENSE", "NOTICE", "SECURITY.md"]) expect(paths).toContain(path)
  expect(paths.some(path => /^(tests|scripts|node_modules|\.git)\//.test(path))).toBe(false)
  expect(paths.some(path => /(?:directory|sessions)\.js$/.test(path))).toBe(false)
  const manifest = await Bun.file(join(repo, "package.json")).json()
  expect(manifest.private).toBe(true)
  expect(manifest.exports).toEqual({ ".": "./dist/index.js", "./tui": "./dist/tui.js" })
}, 30_000)
