/**
 * Compiles `src/**` to `dist/**`, one output file per input file.
 *
 * Why this exists: OpenCode only runs the Solid JSX transform (OpenTUI's own
 * `bun-plugin-solid`) over files whose path does not contain `node_modules`.
 * Every package install — npm or Git — lands the plugin in `node_modules`, so a
 * raw `.tsx` TUI entry never gets that transform. Bun's own JSX transform then
 * compiles it against `@opentui/solid/jsx-runtime`, which is a static runtime:
 * props are values, not getters, so every signal read happens once at mount and
 * the panel never updates (it lists only the session cached at mount).
 *
 * The build therefore runs the same transform OpenCode would, with the same
 * options, so the packaged entry renders reactively wherever it is installed:
 * `babel-preset-solid` with `{ moduleName: "@opentui/solid", generate:
 * "universal" }`.
 *
 * The emitted files import `@opentui/solid` and `solid-js` by their bare names
 * on purpose: OpenCode rewrites exactly those specifiers to its own runtime, so
 * the plugin shares the host's single Solid/OpenTUI instance. Do not add
 * `babel-plugin-module-resolver` here — it would bake in `opentui:runtime-module:`
 * ids that only resolve inside the host process.
 *
 * Output is one file per input (no bundling) so the relative imports between
 * `tui.tsx`, `index.ts`, `rpc.ts`, `directory.ts`, `options.ts` and
 * `sessions.ts` stay relative and both entries keep sharing a single `rpc.js`.
 */
import { transformAsync } from "@babel/core"
import presetTypeScript from "@babel/preset-typescript"
import presetSolid from "babel-preset-solid"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = fileURLToPath(new URL("..", import.meta.url))
const sourceDir = join(projectRoot, "src")
export const defaultOutDir = join(projectRoot, "dist")

/** The entry OpenCode is told to use from `package.json#exports`. */
export const TUI_ENTRY = "tui.js"

const SCRIPT = /\.[cm]?tsx?$/
const JSX = /\.[cm]?[jt]sx$/
/** `.d.ts` and friends match {@link SCRIPT} but have nothing to emit. */
const DECLARATION = /\.d\.[cm]?ts$/

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (SCRIPT.test(entry.name) && !DECLARATION.test(entry.name)) files.push(path)
  }
  return files.sort()
}

/** Compile every `src/**` script into `outDir`; returns the emitted paths, relative to `outDir`. */
export async function build(outDir: string = defaultOutDir): Promise<string[]> {
  await rm(outDir, { recursive: true, force: true })
  const emitted: string[] = []
  for (const file of await sourceFiles(sourceDir)) {
    const presets: unknown[] = []
    if (JSX.test(file)) presets.push([presetSolid, { moduleName: "@opentui/solid", generate: "universal" }])
    if (SCRIPT.test(file)) presets.push([presetTypeScript])

    const transformed = await transformAsync(await readFile(file, "utf8"), {
      filename: file,
      configFile: false,
      babelrc: false,
      presets,
    })
    const code = transformed?.code
    if (code === undefined || code === null) throw new Error(`babel produced no output for ${relative(sourceDir, file)}`)

    const target = join(outDir, relative(sourceDir, file).replace(SCRIPT, ".js"))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, code, "utf8")
    emitted.push(relative(outDir, target))
  }
  return emitted.sort()
}

if (import.meta.main) {
  const files = await build()
  console.log(`built ${files.length} file(s): ${files.join(", ")}`)
}
