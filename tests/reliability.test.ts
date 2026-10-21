import { afterEach, expect, test } from "bun:test"
import { InboxController } from "../src/data/controller.js"
import { readWithDeadline } from "../src/data/deadline.js"
import type { InboxPort } from "../src/data/port.js"
import { deferred, FakePort, session, until } from "./support.js"

const controllers: InboxController[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
})
function controller(port: FakePort, options = {}) {
  const result = new InboxController(port, {
    pollIntervalMs: 5,
    debounceMs: 1,
    requestTimeoutMs: 40,
    ...options,
  })
  controllers.push(result)
  return result
}

test("a scan slower than the polling interval still publishes ready", async () => {
  const port = new FakePort()
  port.sessions = async () => {
    await Bun.sleep(20)
    return { data: [session("slow")] }
  }
  const inbox = controller(port)
  inbox.start()
  await until(() => inbox.current.phase === "ready")
  expect(inbox.current.sessions[0]?.id).toBe("slow")
})

test("continuous events publish progress as stale, and settle ready when the storm ends", async () => {
  const port = new FakePort()
  let calls = 0
  port.sessions = async () => {
    calls++
    await Bun.sleep(8)
    port.handler!({})
    return { data: [session(String(calls))] }
  }
  const inbox = controller(port)
  inbox.start()
  await until(() => inbox.current.updatedAt !== undefined && inbox.current.sessions.length > 0)
  expect(inbox.current.phase).not.toBe("ready")
  port.sessions = async () => ({ data: [session("settled")] })
  await until(() => inbox.current.phase === "ready")
  expect(inbox.current.sessions[0]?.id).toBe("settled")
  expect(calls).toBeLessThan(10)
})

test("an event arriving after pending reads retains its timestamp through a stale scan", async () => {
  const port = new FakePort()
  const active = deferred<Set<string>>()
  port.active = () => active.promise
  const inbox = controller(port, { now: () => 999, pollIntervalMs: 60_000 })
  inbox.start()
  await until(() => inbox.current.phase === "partial")
  // Wait until the pending result has been consumed and active is blocked.
  await Bun.sleep(1)
  port.handler!({ request: { kind: "question", id: "new", created: 123 } })
  port.requests = { permissions: [], questions: [{ id: "new", sessionID: "a" }] }
  active.resolve(new Set())
  await until(() => inbox.current.phase === "ready")
  expect(inbox.current.pending[0]?.since).toBe(123)
})

for (const stage of ["sessions", "pending", "active"] as const) {
  test(`hung ${stage} read times out, aborts, and recovers on polling`, async () => {
    const port = new FakePort()
    const original = port[stage].bind(port)
    let signal: AbortSignal | undefined
    let calls = 0
    // Intentionally ignore cancellation to prove the controller itself is bounded.
    Object.assign(port, {
      [stage]: (...args: unknown[]) => {
        calls++
        if (calls === 1) {
          signal = args.at(-1) as AbortSignal
          return new Promise(() => {})
        }
        return (original as (...args: unknown[]) => unknown)(...args)
      },
    })
    const inbox = controller(port, { requestTimeoutMs: 10 })
    inbox.start()
    await until(() => signal?.aborted === true)
    await until(() => inbox.current.phase === "ready" && calls >= 2)
    expect(inbox.current.sessions).toHaveLength(1)
  })
  test(`dispose during ${stage} aborts without late reads or publication`, async () => {
    const port = new FakePort()
    let signal: AbortSignal | undefined
    Object.assign(port, {
      [stage]: (...args: unknown[]) => {
        signal = args.at(-1) as AbortSignal
        return new Promise(() => {})
      },
    })
    const inbox = controller(port)
    inbox.start()
    await until(() => signal !== undefined)
    inbox.dispose()
    const before = inbox.current
    await Bun.sleep(15)
    expect(signal!.aborted).toBe(true)
    expect(inbox.current).toBe(before)
    expect(port.stopped).toBe(true)
  })
}

test("poll interval changes and missed events eventually reconcile without event invalidation", async () => {
  const port = new FakePort()
  const inbox = controller(port, { pollIntervalMs: 60_000 })
  inbox.start()
  inbox.start()
  await until(() => inbox.current.phase === "ready")
  port.inventory = [session("missed-event")]
  inbox.setPollInterval(2)
  await until(() => inbox.current.sessions[0]?.id === "missed-event")
  expect(inbox.current.phase).toBe("ready")
  inbox.dispose()
  await inbox.refresh()
  inbox.invalidate()
  inbox.start()
})

test("fake inventory cannot mutate a published snapshot before refresh", async () => {
  const port = new FakePort()
  const inbox = controller(port)
  await inbox.refresh()
  port.inventory[0]!.title = "unread mutation"
  expect(inbox.current.sessions[0]?.title).toBe("a")
})

test("manual refreshes coalesce and an aborted deadline never invokes a read", async () => {
  const aborted = AbortSignal.abort()
  let called = false
  await expect(
    readWithDeadline(aborted, 10, async () => {
      called = true
    }),
  ).rejects.toBeDefined()
  expect(called).toBe(false)
  const port = new FakePort()
  const blocked = deferred<Awaited<ReturnType<InboxPort["sessions"]>>>()
  let calls = 0
  port.sessions = async () => (++calls === 1 ? blocked.promise : { data: [] })
  const inbox = controller(port)
  const first = inbox.refresh()
  expect(inbox.refresh()).toBe(first)
  blocked.resolve({ data: [] })
  await first
  await until(() => calls === 2)
  expect(inbox.current.sessions).toEqual([])
})

test("healthy pending progress is visible before unrelated locations and active reads settle", async () => {
  const port = new FakePort()
  const slow = deferred<{ permissions: { id: string; sessionID: string }[]; questions: never[] }>()
  const active = deferred<Set<string>>()
  port.inventory.push(session("b", { location: { directory: "/b" } }))
  port.inventory.push(session("done", { outcome: "succeeded", time: { created: 1, updated: 2, idle: 10 } }))
  port.pending = async (directory) =>
    directory === "/b"
      ? slow.promise
      : {
          permissions: [{ id: "p", sessionID: "a" }],
          questions: [],
        }
  port.active = () => active.promise
  const inbox = controller(port, { requestTimeoutMs: 1000, pollIntervalMs: 60_000 })
  const scan = inbox.refresh()
  await until(() => inbox.current.pending.length === 1)
  expect(inbox.current.phase).toBe("partial")
  expect(inbox.current.running.has("done")).toBe(true)
  slow.resolve({ permissions: [], questions: [] })
  active.resolve(new Set(["done"]))
  await scan
  expect(inbox.current.phase).toBe("ready")
  expect(inbox.current.running.has("done")).toBe(true)
})

test("incremental reads preserve unchecked badges and verified completions, then clear only healthy owners", async () => {
  const port = new FakePort()
  port.inventory.push(session("b", { location: { directory: "/b" } }))
  port.inventory.push(session("done", { outcome: "succeeded", time: { created: 1, updated: 2, idle: 10 } }))
  port.pending = async (directory) => ({
    permissions: [{ id: directory, sessionID: directory === "/a" ? "a" : "b" }],
    questions: [],
  })
  const inbox = controller(port, { pollIntervalMs: 60_000 })
  await inbox.refresh()
  const slow = deferred<{ permissions: never[]; questions: never[] }>()
  port.pending = async (directory) => (directory === "/b" ? slow.promise : { permissions: [], questions: [] })
  const scan = inbox.refresh()
  await until(() => inbox.current.phase === "partial" && inbox.current.pending.length === 1)
  expect(inbox.current.pending[0]!.sessionID).toBe("b")
  expect(inbox.current.running.has("done")).toBe(false)
  slow.reject(new Error("offline"))
  await scan
  expect(inbox.current.phase).toBe("partial")
  expect(inbox.current.pending.map((item) => item.sessionID)).toEqual(["b"])
})
