import { describe, expect, test } from "bun:test"
import { deriveRows, scopeRows, statusLabel } from "../src/attention/derive.js"
import { projectForDirectory } from "../src/attention/scope.js"
import { resolveOptions } from "../src/options.js"
import { safeText, truncate } from "../src/ui/text.js"
import { session, snapshot } from "./support.js"

const done = (id: string, idle = 10) => session(id, { outcome: "succeeded", time: { created: 1, updated: 99, idle } })
describe("native unread completions", () => {
  test("requires a successful unviewed idle, not metadata updates or an absent active drain", () => {
    expect(deriveRows(snapshot({ sessions: [session("metadata"), done("success"),
      session("no-idle", { outcome: "succeeded" }), session("failed", { outcome: "failed", time: { created: 1, updated: 2, idle: 10 } }),
      session("interrupted", { outcome: "interrupted", time: { created: 1, updated: 2, idle: 10 } })] })).map(row => row.session.id)).toEqual(["success"])
  })
  test("another client's viewed state clears only the observed idle", () => {
    const one = done("a")
    one.time.viewed = 10
    expect(deriveRows(snapshot({ sessions: [one] }))).toHaveLength(0)
    one.time.idle = 20
    expect(deriveRows(snapshot({ sessions: [one] }))[0]?.completedIdle).toBe(20)
  })
  test("running, archived and normal child completions are suppressed", () => {
    const child = { ...done("child"), parentID: "parent" }
    const archived = done("archived"); archived.time.archived = 15
    const state = snapshot({ sessions: [done("running"), archived, child], running: new Set(["running"]) })
    expect(deriveRows(state)).toHaveLength(0)
    expect(deriveRows(state, true).map(row => row.session.id)).toEqual(["child"])
  })
})
describe("attention rows", () => {
  test("one row per owner with multiple badges; child request is not duplicated on parent", () => {
    const state = snapshot({ sessions: [session("parent"), { ...done("child"), parentID: "parent" }],
      pending: [
        { id: "p", sessionID: "child", kind: "permission", since: 1 },
        { id: "p", sessionID: "child", kind: "permission", since: 1 },
        { id: "q", sessionID: "child", kind: "question", since: 2 },
      ] })
    const rows = deriveRows(state)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ permissions: 1, questions: 1, parentTitle: "parent" })
    expect(statusLabel(rows[0]!)).toBe("Permission · Question")
  })
  test("archiving or viewing does not resolve a pending request", () => {
    const archived = done("a"); archived.time.archived = 20; archived.time.viewed = 10
    const rows = deriveRows(snapshot({ sessions: [archived], pending: [{ id: "p", sessionID: "a", kind: "permission", since: 1 }] }))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.completedIdle).toBeUndefined()
  })
  test("permissions, questions, newest completions; stable tie-breakers", () => {
    const state = snapshot({ sessions: [session("p2"), done("d1", 11), session("q"), done("d2", 12), session("p1"), session("p0")],
      pending: [
        { id: "p2", sessionID: "p2", kind: "permission", since: 3 },
        { id: "p1", sessionID: "p1", kind: "permission", since: 2 },
        { id: "p0", sessionID: "p0", kind: "permission", since: 2 },
        { id: "q", sessionID: "q", kind: "question", since: 1 },
      ] })
    expect(deriveRows(state).map(row => row.session.id)).toEqual(["p0", "p1", "p2", "q", "d2", "d1"])
  })
  test("scope is project ID, includes worktrees, never acknowledges or drops backing state", () => {
    const state = snapshot({ sessions: [done("a"), { ...done("tree"), location: { directory: "/worktree" } },
      { ...done("b"), projectID: "project-b" }] })
    const rows = deriveRows(state)
    expect(scopeRows(rows, "project", "project-a").map(row => row.session.id)).toEqual(["a", "tree"])
    expect(scopeRows(rows, "project")).toHaveLength(0)
    expect(scopeRows(rows, "all")).toHaveLength(3)
    expect(state.sessions.every(item => item.time.viewed === undefined)).toBe(true)
  })
  test("nested launch paths use longest path-boundary project match", () => {
    const projects = [{ id: "a", canonical: "/a", sandboxes: ["/tree"] }, { id: "nested", canonical: "/a/nested", sandboxes: [] }]
    expect(projectForDirectory("/tree/src", projects)).toBe("a")
    expect(projectForDirectory("/a/nested/src", projects)).toBe("nested")
    expect(projectForDirectory("/another", projects)).toBeUndefined()
  })
})
test("options are bounded and CLI overrides server defaults", () => {
  expect(resolveOptions()).toEqual({ defaultScope: "project", maxVisibleRows: 4, pollIntervalMs: 30000, includeChildCompletions: false })
  expect(resolveOptions({ maxVisibleRows: 99, pollIntervalMs: 1 }, { defaultScope: "all", maxVisibleRows: 2 })).toMatchObject({ defaultScope: "all", maxVisibleRows: 2, pollIntervalMs: 5000 })
  expect(resolveOptions({ pollIntervalMs: NaN, maxVisibleRows: "oops", includeChildCompletions: "yes" })).toEqual(resolveOptions())
})
test("untrusted terminal titles are single-line, ANSI-free and grapheme/cell-safe", () => {
  expect(safeText("\x1b[31mHello\x1b[0m\nworld\u202e!")).toBe("Hello world !")
  expect(safeText("\x1b]8;;https://evil.test\x07link\x1b]8;;\x07")).toBe("link")
  expect(truncate("abcdef", 5)).toBe("ab...")
  expect(truncate("a", 0)).toBe("")
  expect(truncate("abcdef", 2)).toBe("..")
  expect(Bun.stringWidth(truncate("👩‍💻中文abcdef", 7))).toBeLessThanOrEqual(7)
  expect(truncate("e\u0301e\u0301abcdef", 5)).toBe("e\u0301e\u0301...")
})
