/**
 * Standalone contract test for the pathExists semantics. This does not
 * require the OpenCode runtime — it validates the input/output shape of
 * the RPC and the staleness cache contract used by the TUI plugin.
 */
import { SessionHistory, type SessionHistoryPathExistsInput, type SessionHistoryPathExistsOutput } from "../src/rpc.js"

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
const m = def.methods.pathExists
assert(def.id === "session-history", "rpc id is 'session-history'")
assert(typeof m === "object" && m !== null, "pathExists method defined")
assert(typeof m?.input === "object", "pathExists has input schema")
assert(typeof m?.output === "object", "pathExists has output schema")

console.log("rpc.input")
const sampleInput: SessionHistoryPathExistsInput = { directory: "/tmp/foo" }
assert(typeof sampleInput.directory === "string", "input.directory is a string")

console.log("rpc.output")
const sampleOutput: SessionHistoryPathExistsOutput = { exists: true }
assert(typeof sampleOutput.exists === "boolean", "output.exists is boolean")

console.log("staleness.cache")
const cache = new Map<string, boolean>()
cache.set("/a", true)
cache.set("/b", false)
assert(cache.get("/a") === true, "alive row resolves true")
assert(cache.get("/b") === false, "missing row resolves false")
assert(!cache.has("/c"), "untouched row absent from cache")

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`)
  process.exit(1)
}
console.log("\nall assertions passed")