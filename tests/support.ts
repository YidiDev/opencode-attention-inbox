import type { Session, Snapshot } from "../src/attention/model.js"
import type { InboxPort, Invalidation } from "../src/data/port.js"

export const theme = {
  text: {
    base: "white",
    muted: "gray",
    action: { secondary: { state: () => "white" } },
    feedback: { warning: { base: "yellow" }, info: { base: "cyan" } },
  },
  background: {
    action: {
      secondary: {
        state: ({ selected, hovered }: { selected?: boolean; hovered?: boolean }) =>
          selected ? "#334455" : hovered ? "#223344" : "transparent",
      },
    },
  },
  border: { base: "gray" },
}

export function session(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    projectID: "project-a",
    title: id,
    location: { directory: "/a" },
    time: { created: 1, updated: 2 },
    ...extra,
  }
}
export function snapshot(extra: Partial<Snapshot> = {}): Snapshot {
  return { sessions: [], pending: [], running: new Set(), phase: "ready", ...extra }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await Bun.sleep(5)
  }
  throw new Error("condition did not settle")
}
export class FakePort implements InboxPort {
  inventory: Session[] = [session("a")]
  requests: Awaited<ReturnType<InboxPort["pending"]>> = { permissions: [], questions: [] }
  running = new Set<string>()
  handler?: (event: Invalidation) => void
  stopped = false
  listCalls = 0
  sessions: InboxPort["sessions"] = async () => {
    this.listCalls++
    return { data: structuredClone(this.inventory) }
  }
  pending: InboxPort["pending"] = async () => structuredClone(this.requests)
  active: InboxPort["active"] = async () => new Set(this.running)
  listen(handler: (event: Invalidation) => void) {
    this.handler = handler
    return () => {
      this.stopped = true
    }
  }
}
