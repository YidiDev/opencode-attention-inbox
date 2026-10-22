import { afterEach, expect, test } from "bun:test"
import { deriveRows } from "../src/attention/derive.js"
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

test("large directory inventories bound full snapshot derivations and preserve the final result", async () => {
  const port = new FakePort()
  port.inventory = Array.from({ length: 3000 }, (_, index) =>
    session(String(index), { location: { directory: `/${index}` } }),
  )
  port.sessions = async (cursor) => {
    const offset = Number(cursor ?? 0)
    return {
      data: structuredClone(port.inventory.slice(offset, offset + 100)),
      next: offset + 100 < port.inventory.length ? String(offset + 100) : undefined,
    }
  }
  port.pending = async (directory) => ({
    permissions: [],
    questions: [{ id: directory, sessionID: directory.slice(1) }],
  })
  const inbox = controller(port, { pollIntervalMs: 60_000, requestTimeoutMs: 1000 })
  let publications = 0
  let count = 0
  inbox.subscribe((state) => {
    publications++
    count = deriveRows(state).length
  })
  await inbox.refresh()
  expect(publications).toBeLessThanOrEqual(6)
  expect(count).toBe(3000)
  expect(inbox.current.phase).toBe("ready")
  // Warm scans must not re-derive last-known rows once per inventory page either.
  publications = 0
  await inbox.refresh()
  expect(publications).toBeLessThanOrEqual(5)
  expect(count).toBe(3000)
})

test("event bursts bound full snapshot derivations and preserve timestamps and reconciliation", async () => {
  const port = new FakePort()
  port.inventory = Array.from({ length: 3000 }, (_, index) => session(String(index)))
  port.requests.questions = port.inventory.map((owner) => ({ id: owner.id, sessionID: owner.id }))
  const inbox = controller(port, { pollIntervalMs: 60_000, requestTimeoutMs: 1000 })
  let publications = 0
  let rows = 0
  inbox.subscribe((state) => {
    publications++
    rows = deriveRows(state).length
  })
  inbox.start()
  await until(() => inbox.current.phase === "ready")
  const calls = port.listCalls
  publications = 0
  for (let index = 0; index < 1000; index++) {
    port.handler!({ request: { kind: "question", id: "0", created: 1000 - index } })
    expect(inbox.current.phase).toBe("stale")
  }
  expect(publications).toBe(1)
  expect(rows).toBe(3000)
  expect(port.listCalls).toBe(calls)
  await until(() => inbox.current.phase === "ready")
  expect(publications).toBeLessThanOrEqual(5)
  expect(port.listCalls).toBe(calls + 1)
  expect(rows).toBe(3000)
  expect(inbox.current.pending.find((item) => item.id === "0")?.since).toBe(1)
})

test("events during initial syncing still invalidate in-flight reads without duplicate publications", async () => {
  const port = new FakePort()
  const blocked = deferred<Awaited<ReturnType<InboxPort["sessions"]>>>()
  let calls = 0
  port.sessions = async () => (++calls === 1 ? blocked.promise : { data: [session("latest")] })
  const inbox = controller(port, { pollIntervalMs: 60_000, requestTimeoutMs: 1000 })
  inbox.start()
  await until(() => calls === 1)
  let publications = 0
  inbox.subscribe(() => publications++)
  publications = 0
  for (let index = 0; index < 1000; index++) port.handler!({})
  expect(publications).toBe(0)
  expect(inbox.current.phase).toBe("syncing")
  blocked.resolve({ data: [session("outdated")] })
  await until(() => inbox.current.phase === "ready")
  expect(calls).toBe(2)
  expect(inbox.current.sessions[0]?.id).toBe("latest")
})

test("progress batches publish during a blocked scan and preserve event uncertainty", async () => {
  const port = new FakePort()
  port.inventory.push(session("b", { location: { directory: "/b" } }))
  port.inventory.push(session("c", { location: { directory: "/c" } }))
  const later = deferred<{ permissions: never[]; questions: { id: string; sessionID: string }[] }>()
  const blocked = deferred<{ permissions: never[]; questions: never[] }>()
  port.pending = async (directory) =>
    directory === "/a"
      ? { permissions: [], questions: [{ id: "a", sessionID: "a" }] }
      : directory === "/b"
        ? later.promise
        : blocked.promise
  const inbox = controller(port, { pollIntervalMs: 60_000, requestTimeoutMs: 1000 })
  inbox.start()
  await until(() => inbox.current.pending.length === 1)
  port.handler!({})
  later.resolve({ permissions: [], questions: [{ id: "b", sessionID: "b" }] })
  await until(() => inbox.current.pending.length === 2)
  expect(inbox.current.phase).toBe("stale")
  inbox.dispose()
  const before = inbox.current
  blocked.resolve({ permissions: [], questions: [] })
  await Bun.sleep(60)
  expect(inbox.current).toBe(before)
})

test("disposing a queued progress batch cancels late publication", async () => {
  const port = new FakePort()
  port.inventory.push(session("b", { location: { directory: "/b" } }))
  port.inventory.push(session("c", { location: { directory: "/c" } }))
  const later = deferred<{ permissions: never[]; questions: { id: string; sessionID: string }[] }>()
  port.pending = async (directory) =>
    directory === "/a"
      ? { permissions: [], questions: [{ id: "a", sessionID: "a" }] }
      : directory === "/b"
        ? later.promise
        : new Promise(() => {})
  const inbox = controller(port, { requestTimeoutMs: 1000 })
  const scan = inbox.refresh()
  await until(() => inbox.current.pending.length === 1)
  later.resolve({ permissions: [], questions: [{ id: "b", sessionID: "b" }] })
  await Bun.sleep(1)
  inbox.dispose()
  const before = inbox.current
  await scan
  await Bun.sleep(60)
  expect(inbox.current).toBe(before)
  expect(inbox.current.pending).toHaveLength(1)
})
