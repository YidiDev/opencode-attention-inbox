/**
 * Standalone contract test for the check RPC and the session-list helpers.
 * This does not require the OpenCode runtime — it validates the input/output
 * shape of the RPC and the pure selection helpers used by the TUI plugin.
 */
import { MAX_DIRECTORIES, SessionHistory, type SessionHistoryCheckInput, type SessionHistoryCheckOutput } from "../src/rpc.js"
import { directoryExists, missingDirectories } from "../src/directory.js"
import { filterSessions, homePanelWidth, mergeSessions, projectLabel, scopeToCurrentProject } from "../src/sessions.js"
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
  methods: Record<string, { input: object; output: object }>
}
const m = def.methods.check
assert(def.id === "session-history", "rpc id is 'session-history'")
assert(typeof m === "object" && m !== null, "check method defined")
assert(typeof m?.input === "object", "check has input schema")
assert(typeof m?.output === "object", "check has output schema")

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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log("\nall assertions passed")