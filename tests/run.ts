/**
 * Standalone contract test for the check RPC and the session-list helpers.
 * This does not require the OpenCode runtime — it validates the input/output
 * shape of the RPC and the pure selection helpers used by the TUI plugin.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  MAX_DIRECTORIES,
  SessionHistory,
  type SessionHistoryCheckInput,
  type SessionHistoryCheckOutput,
  type SessionHistorySettingsOutput,
} from "../src/rpc.js"
import { directoryExists, missingDirectories } from "../src/directory.js"
import {
  filterSessions,
  homePanelWidth,
  mergeSessions,
  projectLabel,
  scopeToCurrentProject,
  sessionListHeight,
  truncateToWidth,
} from "../src/sessions.js"
import { resolveOptions } from "../src/options.js"
import { build, defaultOutDir, TUI_ENTRY } from "../scripts/build.js"
import type { Project, SessionInfo } from "@opencode/client"

let failures = 0
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failures++
    console.error("  ✗ " + msg)
  } else {
    console.log("  ✓ " + msg)
  }
}

console.log("rpc.shape")
const def = SessionHistory as unknown as {
  id: string
  methods: Record<string, { input: unknown; output: unknown }>
}
const m = def.methods.check
assert(def.id === "session-history", "rpc id is 'session-history'")
assert(typeof m === "object" && m !== null, "check method defined")
assert(typeof m?.input === "object", "check has input schema")
assert(typeof m?.output === "object", "check has output schema")

console.log("rpc.settings")
// Config options reach the server half only, so the TUI reads them over this
// method. The output must allow arbitrary option keys.
const settingsMethod = def.methods.settings
assert(typeof settingsMethod === "object" && settingsMethod !== null, "settings method defined")
assert(typeof settingsMethod?.input === "object", "settings has input schema")
assert(typeof settingsMethod?.output === "object", "settings has output schema")
const optionsSchema = (
  settingsMethod?.output as { properties?: Record<string, { additionalProperties?: boolean }> }
)?.properties?.options
assert(optionsSchema?.additionalProperties === true, "settings output accepts arbitrary option keys")
const sampleSettings: SessionHistorySettingsOutput = { options: { limit: 5 } }
assert(sampleSettings.options.limit === 5, "settings.options carries the configured values")

console.log("options.resolve")
assert(
  JSON.stringify(resolveOptions()) ===
    JSON.stringify({
      limit: 100,
      maxVisibleSessions: 3,
      truncateSessionTitles: true,
      showMetrics: true,
      showAllProjects: true,
    }),
  "no sources falls back to the documented defaults",
)
assert(resolveOptions({ limit: 10 }).limit === 10, "reads a numeric limit")
assert(resolveOptions({ limit: "10" }).limit === 100, "ignores a wrongly typed limit")
assert(resolveOptions({ limit: -3 }).limit === 0, "clamps a negative limit")
assert(resolveOptions({ limit: 2.7 }).limit === 2, "floors a fractional limit")
assert(resolveOptions({ limit: Infinity }).limit === 100, "ignores a non-finite limit")
assert(
  resolveOptions({ maxVisibleSessions: 2 }).maxVisibleSessions === 2,
  "reads a numeric visible-session count",
)
assert(
  resolveOptions({ maxVisibleSessions: "2" }).maxVisibleSessions === 3,
  "ignores a wrongly typed visible-session count",
)
assert(
  resolveOptions({ maxVisibleSessions: 0 }).maxVisibleSessions === 1,
  "clamps the visible-session count to at least one",
)
assert(
  resolveOptions({ maxVisibleSessions: 2.7 }).maxVisibleSessions === 2,
  "floors a fractional visible-session count",
)
assert(
  resolveOptions({ truncateSessionTitles: false }).truncateSessionTitles === false,
  "reads the title truncation option",
)
assert(
  resolveOptions({ truncateSessionTitles: "false" }).truncateSessionTitles === true,
  "ignores a wrongly typed title truncation option",
)
assert(resolveOptions({ showMetrics: false }).showMetrics === false, "reads a boolean option")
assert(resolveOptions({ showMetrics: "false" }).showMetrics === true, "ignores a wrongly typed boolean")
assert(
  resolveOptions({ showAllProjects: false }, { showAllProjects: true }).showAllProjects === true,
  "later sources win",
)
assert(
  resolveOptions({ limit: 7, showMetrics: false }, { showAllProjects: false }).limit === 7,
  "keys absent from a later source keep their earlier value",
)

console.log("sessions.listHeight")
assert(sessionListHeight(3, true) === 9, "three rows with metrics need nine lines")
assert(sessionListHeight(3, false) === 6, "three rows without metrics need six lines")
assert(sessionListHeight(1, true) === 3, "one row still reserves title, metrics and border")
assert(sessionListHeight(0, true) === 3, "never collapses below one row")

console.log("sessions.truncate")
assert(truncateToWidth("hello", 5) === "hello", "text that fits is unchanged")
assert(truncateToWidth("hello world", 8) === "hello...", "cuts at the end and appends an ellipsis")
assert(truncateToWidth("hello", 0) === "hello", "unknown width leaves the title alone")
assert(truncateToWidth("hello", 3) === "...", "a tiny budget still shows the ellipsis")
assert(truncateToWidth("日本語です", 5) === "日...", "counts wide characters by terminal cells")

console.log("rpc.input")
const sampleInput: SessionHistoryCheckInput = { directories: ["/tmp/foo"] }
assert(Array.isArray(sampleInput.directories), "input.directories is an array")

console.log("rpc.output")
const sampleOutput: SessionHistoryCheckOutput = { missing: [] }
assert(Array.isArray(sampleOutput.missing), "output.missing is an array")

console.log("staleness.cache")
const cache = new Map<string, boolean>()
cache.set("/a", true)
cache.set("/b", false)
assert(cache.get("/a") === true, "alive row resolves true")
assert(cache.get("/b") === false, "missing row resolves false")
assert(!cache.has("/c"), "untouched row absent from cache")

// --- session list selection -------------------------------------------------

function row(
  id: string,
  directory: string,
  updated: number,
  extra: Partial<{ title: string; parentID: string; archived: number }> = {},
): SessionInfo {
  const { title, parentID, archived } = extra
  return {
    id,
    title: title ?? id,
    parentID,
    cost: 0,
    location: { directory },
    time: { created: updated, updated, archived },
  } as unknown as SessionInfo
}

console.log("sessions.scope")
const scoped = scopeToCurrentProject(
  [row("a", "/work/alpha", 3), row("b", "/work/beta", 2), row("c", "/other/gamma", 1)],
  "/work/alpha",
  [{ canonical: "/work/beta" } as unknown as Project],
)
assert(scoped.map((s) => s.id).join(",") === "a,b", "keeps current dir and known project roots")
assert(scoped.every((s) => s.id !== "c"), "drops unknown project")

console.log("sessions.merge")
const remote = [row("a", "/work/alpha", 3, { title: "remote-a" }), row("d", "/work/delta", 4)]
const cachedRow = row("a", "/work/alpha", 9, { title: "live-a" })
const merged = mergeSessions(remote, [cachedRow])
assert(merged.length === 2, "dedupes by id")
assert(merged.find((s) => s.id === "a")?.title === "live-a", "reactive cache wins over remote")
assert(merged.some((s) => s.id === "d"), "remote-only sessions kept")

console.log("sessions.filter")
const filtered = filterSessions(
  [
    row("old", "/work/alpha", 1),
    row("new", "/work/beta", 5),
    row("child", "/work/alpha", 6, { parentID: "new" }),
    row("archived", "/work/alpha", 7, { archived: 7 }),
    row("mid", "/work/alpha", 3, { title: "Deploy pipeline" }),
  ],
  "",
)
assert(filtered.map((s) => s.id).join(",") === "new,mid,old", "newest first, drops children and archived")
const searched = filterSessions([row("x", "/w", 1, { title: "Refactor auth" }), row("y", "/w", 2)], "auth")
assert(searched.length === 1 && searched[0]?.id === "x", "search matches title")
const byId = filterSessions([row("ses_abc", "/w", 1), row("z", "/w", 2)], "ABC")
assert(byId.length === 1 && byId[0]?.id === "ses_abc", "search matches id, case-insensitive")

console.log("sessions.filter.project")
const proj = [
  { id: "p1", canonical: "/work/alpha" } as unknown as Project,
  { id: "p2", canonical: "/work/root", name: "Billing" } as unknown as Project,
]
const rows = [
  row("a", "/work/alpha/sub", 1), // working dir is a subpath of project p1
  { ...row("b", "/tmp/wt/feat", 2), projectID: "p2" } as unknown as SessionInfo, // worktree: dir differs from project root
  { ...row("c", "/elsewhere", 3), projectID: "p3" } as unknown as SessionInfo,
]
assert(filterSessions(rows, "alpha", proj).map((s) => s.id).join(",") === "a", "matches working directory")
assert(
  filterSessions(rows, "billing", proj).map((s) => s.id).join(",") === "b",
  "matches project name via projectID even when the working dir differs",
)
assert(
  filterSessions(rows, "work/root", proj).map((s) => s.id).join(",") === "b",
  "matches project canonical root",
)
assert(filterSessions(rows, "alpha", []).length === 1, "falls back to directory-only when no projects given")

console.log("sessions.homePanel")
assert(homePanelWidth(100) === 0, "hidden when the terminal is too narrow")
assert(homePanelWidth(120) === 22, "narrowest usable panel")
assert(homePanelWidth(200) === 42, "caps at the sidebar width")
assert(
  [120, 140, 160, 200, 240].every((w) => {
    const panel = homePanelWidth(w)
    return panel === 0 || w - panel >= (w + 75) / 2 // panel left edge >= centered content right edge
  }),
  "panel never overlaps the centered home content",
)

console.log("sessions.label")
assert(projectLabel("/Users/me/repos/alpha") === "alpha", "label is last path segment")
assert(projectLabel("/") === "/", "root path falls back to itself")

console.log("directory.exists")
assert((await directoryExists(process.cwd())) === true, "existing directory resolves true")
assert((await directoryExists("/no/such/dir/opencode-session-history")) === false, "missing directory resolves false")
assert((await directoryExists("")) === false, "empty path resolves false")
assert((await directoryExists(undefined)) === false, "non-string path resolves false")

console.log("directory.missing")
assert((await missingDirectories([])).length === 0, "empty request yields nothing")
assert(
  (await missingDirectories([process.cwd(), "/no/such/dir/a"])).join(",") === "/no/such/dir/a",
  "reports only the missing directory",
)
assert(
  (await missingDirectories(["/no/such/dir/b", "/no/such/dir/b"])).join(",") === "/no/such/dir/b",
  "deduplicates input",
)
assert(
  (await missingDirectories([null, 42, "", "/no/such/dir/c"])).join(",") === "/no/such/dir/c",
  "drops non-string and empty entries",
)
const many = Array.from({ length: MAX_DIRECTORIES + 5 }, (_, index) => `/no/such/dir/${index}`)
assert((await missingDirectories(many)).length === MAX_DIRECTORIES, "caps the request at MAX_DIRECTORIES")

console.log("tui.jsx")
// `src/tui.tsx` is still loaded raw when the plugin is configured by path from
// a checkout, where no tsconfig.json sits next to it. Without an explicit JSX
// runtime Bun would emit `react/jsx-dev-runtime`, which the loader does not
// rewrite.
const tuiSource = await readFile(new URL("../src/tui.tsx", import.meta.url), "utf8")
assert(
  tuiSource.startsWith("/** @jsxImportSource @opentui/solid */"),
  "tui.tsx declares the @opentui/solid JSX runtime (pragma required without tsconfig)",
)

console.log("package.build")
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  exports?: Record<string, string>
  files?: string[]
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}
const tuiExport = manifest.exports?.["./tui"]
assert(tuiExport === `./dist/${TUI_ENTRY}`, `exports["./tui"] points at the compiled entry (${tuiExport})`)
assert(manifest.exports?.["."] === "./dist/index.js", 'exports["."] points at the compiled server entry')
assert(manifest.files?.includes("dist") === true, 'package "files" ships dist/')

// OpenCode applies the Solid JSX transform only to files outside node_modules,
// so an installed package must ship JS that was already compiled with it. The
// committed dist/ has to match a fresh build: a stale dist silently reverts the
// TUI entry to Bun's static JSX transform, which renders the panel once and
// never updates.
async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(join(directory, entry.name), path)))
    else files.push(path)
  }
  return files.sort()
}

const scratch = await mkdtemp(join(tmpdir(), "opencode-session-history-build-"))
try {
  const emitted = await build(scratch)
  assert(emitted.includes(TUI_ENTRY), `the build emits ${TUI_ENTRY}`)
  assert(emitted.includes("index.js"), "the build emits the server entry")

  const committed = await listFiles(defaultOutDir)
  assert(
    committed.join(",") === emitted.join(","),
    `dist/ holds exactly the built files (${committed.length} vs ${emitted.length})`,
  )
  for (const file of emitted) {
    const [fresh, onDisk] = await Promise.all([
      readFile(join(scratch, file), "utf8"),
      readFile(join(defaultOutDir, file), "utf8").catch(() => undefined),
    ])
    assert(onDisk === fresh, `dist/${file} is up to date (run \`bun run build\`)`)
  }
} finally {
  await rm(scratch, { recursive: true, force: true })
}

const compiledTui = await readFile(join(defaultOutDir, TUI_ENTRY), "utf8")
assert(
  /from "@opentui\/solid"/.test(compiledTui) && compiledTui.includes('from "solid-js"'),
  "compiled entry imports the host @opentui/solid and solid-js runtimes by name",
)
assert(
  !compiledTui.includes("opentui:runtime-module:"),
  "compiled entry does not bake in runtime module ids (the host rewrites the bare specifiers)",
)
assert(!compiledTui.includes("jsxDEV("), "compiled entry is not emitted by Bun's static JSX transform")
assert(compiledTui.includes("_$effect") && /get \w+\(\)/.test(compiledTui), "compiled entry is reactive (effects + prop getters)")

console.log("package.peers")
// OpenCode rewrites @opentui/solid, solid-js and @opencode/plugin to its own
// runtime. The peers must still actually be installed with the package: marking
// them optional stops the installer from fetching them and loading then fails
// with "Cannot find package '@opentui/solid'".
const requiredPeers = ["@opentui/core", "@opentui/solid", "solid-js"]
assert(
  requiredPeers.every((name) => name in (manifest.peerDependencies ?? {})),
  "OpenTUI/Solid peers are declared",
)
assert(
  requiredPeers.every((name) => manifest.peerDependenciesMeta?.[name]?.optional !== true),
  "peers are not optional, so they are installed with the plugin",
)

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log("\nall assertions passed")