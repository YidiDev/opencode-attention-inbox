import { readdir, readFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { createCoverageMap } from "istanbul-lib-coverage"
import { createContext } from "istanbul-lib-report"
import reports from "istanbul-reports"

const root = resolve(import.meta.dir, "..")
const child = Bun.spawn(["bun", "test", "--preload", "./scripts/coverage-preload.mjs", "tests"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
if (await child.exited) process.exit(1)
const map = createCoverageMap(
  JSON.parse(await readFile(resolve(root, "coverage/coverage-final.json"), "utf8")),
)
const policy = JSON.parse(await readFile(resolve(root, "coverage-policy.json"), "utf8"))
const sources = (await readdir(resolve(root, "src"), { recursive: true })).filter((path) =>
  /\.tsx?$/.test(path),
)
let failed = false
for (const source of sources) {
  const path = `src/${source}`
  if (policy.typeOnly.includes(path)) continue
  if (!map.files().some((file) => relative(root, file) === path)) {
    console.error(`Missing coverage: ${path}`)
    failed = true
    continue
  }
  const summary = map.fileCoverageFor(resolve(root, path)).toSummary()
  const thresholds = { ...policy.default, ...policy.files[path] }
  for (const [metric, minimum] of Object.entries(thresholds)) {
    const actual = summary.data[metric].pct
    if (actual < minimum) {
      console.error(`${path} ${metric}: ${actual}% < ${minimum}%`)
      failed = true
    }
  }
}
const context = createContext({ dir: resolve(root, "coverage"), coverageMap: map })
for (const name of ["text", "lcovonly", "html"]) reports.create(name).execute(context)
if (failed) process.exit(1)
