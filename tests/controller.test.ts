import { afterEach, expect, test } from "bun:test"
import { deriveRows } from "../src/attention/derive.js"
import { InboxController } from "../src/data/controller.js"
import type { InboxPort } from "../src/data/port.js"
import { deferred, FakePort, session, until } from "./support.js"

const controllers: InboxController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})
function controller(port = new FakePort(), now = () => 100) {
  const result = new InboxController(port, { pollIntervalMs: 60_000, debounceMs: 1, now })
  controllers.push(result)
  return result
}
test("startup discovers pre-existing permissions/questions without events", async () => {
  const port = new FakePort()
  port.requests = { permissions: [{ id: "p", sessionID: "a" }], questions: [{ id: "q", sessionID: "a" }] }
  const inbox = controller(port)
  inbox.start()
  await until(() => inbox.current.phase === "ready")
  expect(deriveRows(inbox.current)[0]).toMatchObject({ permissions: 1, questions: 1, since: 100 })
  expect(inbox.current.pending[0]).not.toHaveProperty("message")
})
test("subscribe precedes snapshot; a dirty in-flight result never becomes ready", async () => {
  const port = new FakePort()
  const blocked = deferred<Awaited<ReturnType<InboxPort["sessions"]>>>()
  let calls = 0
  port.sessions = async () => {
    expect(port.handler).toBeDefined()
    return ++calls === 1 ? blocked.promise : { data: [session("new")] }
  }
  const inbox = controller(port)
  const ready: string[][] = []
  inbox.subscribe((state) => {
    if (state.phase === "ready") ready.push(state.sessions.map((item) => item.id))
  })
  inbox.start()
  port.handler!({})
  blocked.resolve({ data: [session("old")] })
  await until(() => inbox.current.phase === "ready")
  expect(ready.every((ids) => !ids.includes("old"))).toBe(true)
  expect(inbox.current.sessions[0]?.id).toBe("new")
})
test("all inventory pages beyond upstream's 500-session cap, including children", async () => {
  const port = new FakePort()
  const cursors: (string | undefined)[] = []
  port.sessions = async (cursor) => {
    cursors.push(cursor)
    const page = Number(cursor ?? 0)
    return {
      data: Array.from({ length: 100 }, (_, index) => session(`${page}-${index}`, { parentID: "parent" })),
      next: page < 6 ? String(page + 1) : undefined,
    }
  }
  const inbox = controller(port)
  await inbox.refresh()
  expect(inbox.current.sessions).toHaveLength(700)
  expect(cursors).toHaveLength(7)
  expect(inbox.current.phase).toBe("ready")
})
test("repeated cursors and failed listing are explicit stale, not empty", async () => {
  const port = new FakePort()
  const inbox = controller(port)
  await inbox.refresh()
  port.sessions = async () => ({ data: [], next: "loop" })
  await inbox.refresh()
  expect(inbox.current.phase).toBe("stale")
  expect(inbox.current.sessions).toHaveLength(1)
  port.sessions = async () => {
    throw new Error("offline")
  }
  await inbox.refresh()
  expect(inbox.current.phase).toBe("stale")
  expect(inbox.current.sessions).toHaveLength(1)
})
test("cross-project resolution, multi-client viewing, rename and deletion reconcile", async () => {
  const port = new FakePort()
  port.inventory = [
    session("a"),
    session("b", {
      projectID: "project-b",
      location: { directory: "/b" },
      outcome: "succeeded",
      time: { created: 1, updated: 2, idle: 10 },
    }),
  ]
  port.requests.permissions = [{ id: "p", sessionID: "b" }]
  const inbox = controller(port)
  await inbox.refresh()
  expect(deriveRows(inbox.current)).toHaveLength(1)
  port.requests.permissions = []
  port.inventory[1]!.time.viewed = 10
  port.inventory[1]!.title = "renamed"
  await inbox.refresh()
  expect(deriveRows(inbox.current)).toHaveLength(0)
  port.inventory = []
  await inbox.refresh()
  expect(inbox.current.sessions).toHaveLength(0)
})
test("failed location retains its pending badge, while resolved healthy locations clear", async () => {
  const port = new FakePort()
  port.inventory.push(session("b", { location: { directory: "/b" } }))
  port.pending = async (directory) => ({
    permissions: [{ id: directory, sessionID: directory === "/a" ? "a" : "b" }],
    questions: [],
  })
  const inbox = controller(port)
  await inbox.refresh()
  port.pending = async (directory) => {
    if (directory === "/b") throw new Error("unavailable")
    return { permissions: [], questions: [] }
  }
  await inbox.refresh()
  expect(inbox.current.phase).toBe("partial")
  expect(inbox.current.pending.map((item) => item.sessionID)).toEqual(["b"])
})
test("location fanout is bounded and sessions in the same worktree share requests", async () => {
  const port = new FakePort()
  port.inventory = Array.from({ length: 12 }, (_, index) =>
    session(String(index), { location: { directory: `/${index % 6}` } }),
  )
  let concurrent = 0,
    peak = 0,
    calls = 0
  port.pending = async () => {
    calls++
    concurrent++
    peak = Math.max(peak, concurrent)
    await Bun.sleep(1)
    concurrent--
    return { permissions: [], questions: [] }
  }
  await controller(port).refresh()
  expect(calls).toBe(6)
  expect(peak).toBeLessThanOrEqual(4)
})
test("event timestamps and first-observed ordering survive repeated snapshots", async () => {
  const port = new FakePort()
  port.requests.questions = [{ id: "q", sessionID: "a" }]
  let now = 100
  const inbox = controller(port, () => now)
  inbox.start()
  await until(() => inbox.current.phase === "ready")
  now = 200
  port.handler!({ request: { id: "q", kind: "question", created: 10 } })
  await until(() => inbox.current.phase === "ready" && inbox.current.pending[0]?.since === 10)
  await inbox.refresh()
  expect(inbox.current.pending[0]?.since).toBe(10)
})
test("disposal aborts requests, unsubscribes, and blocks late publication", async () => {
  const port = new FakePort()
  const blocked = deferred<Awaited<ReturnType<InboxPort["sessions"]>>>()
  let signal: AbortSignal | undefined
  port.sessions = async (_, inputSignal) => {
    signal = inputSignal
    return blocked.promise
  }
  const inbox = controller(port)
  inbox.start()
  await until(() => signal !== undefined)
  inbox.dispose()
  const state = inbox.current
  blocked.resolve({ data: [session("late")] })
  await Bun.sleep(5)
  expect(signal?.aborted).toBe(true)
  expect(port.stopped).toBe(true)
  expect(inbox.current).toBe(state)
})
test("an orphaned request prevents a misleading complete/empty view", async () => {
  const port = new FakePort()
  port.requests.permissions = [{ id: "p", sessionID: "not-yet-indexed" }]
  const inbox = controller(port)
  await inbox.refresh()
  expect(inbox.current.phase).toBe("partial")
})
