import type { Pending, Snapshot } from "../attention/model.js"
import { readWithDeadline } from "./deadline.js"
import type { InboxPort } from "./port.js"

export interface ControllerOptions {
  pollIntervalMs: number
  debounceMs?: number
  requestTimeoutMs?: number
  now?: () => number
}

/** One setup-owned reconciler, not one fetch loop per sidebar mount. */
export class InboxController {
  private snapshot: Snapshot = { sessions: [], pending: [], running: new Set(), phase: "syncing" }
  private listeners = new Set<(snapshot: Snapshot) => void>()
  private abort = new AbortController()
  private firstSeen = new Map<string, number>()
  private stopEvents?: () => void
  private timer?: ReturnType<typeof setTimeout>
  private poll?: ReturnType<typeof setTimeout>
  private inFlight?: Promise<void>
  private generation = 0
  private dirty = false
  private disposed = false
  private now: () => number

  constructor(
    private port: InboxPort,
    private options: ControllerOptions,
  ) {
    this.now = options.now ?? Date.now
  }
  get current() {
    return this.snapshot
  }
  setPollInterval(interval: number) {
    this.options.pollIntervalMs = interval
    if (!this.inFlight) this.schedulePoll()
  }
  private schedulePoll() {
    if (this.poll) clearTimeout(this.poll)
    if (!this.stopEvents || this.disposed) return
    // Polling is a refresh request, not evidence that an in-flight read is old.
    // Start the delay after settling, so a slow scan cannot starve forever.
    this.poll = setTimeout(() => {
      this.poll = undefined
      void this.refresh()
    }, this.options.pollIntervalMs)
  }
  subscribe(listener: (snapshot: Snapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }
  start() {
    if (this.stopEvents || this.disposed) return
    // Subscribe before the first read. Events during a scan force another scan.
    this.stopEvents = this.port.listen((event) => {
      if (event.request) {
        const key = `${event.request.kind}:${event.request.id}`
        this.firstSeen.set(key, Math.min(this.firstSeen.get(key) ?? Infinity, event.request.created))
      }
      this.invalidate()
    })
    void this.refresh()
  }
  private emit(snapshot: Snapshot) {
    if (this.disposed) return
    this.snapshot = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
  invalidate() {
    if (this.disposed) return
    this.generation++
    this.dirty = true
    this.emit({ ...this.snapshot, phase: this.snapshot.updatedAt === undefined ? "syncing" : "stale" })
    // Leading-edge debounce: continuous events must not postpone a read forever.
    if (!this.timer && !this.inFlight) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.refresh()
      }, this.options.debounceMs ?? 200)
    }
  }
  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.inFlight) {
      this.dirty = true
      return this.inFlight
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.poll) {
      clearTimeout(this.poll)
      this.poll = undefined
    }
    this.dirty = false
    this.inFlight = this.reconcile().finally(() => {
      this.inFlight = undefined
      if (this.dirty && !this.disposed) void this.refresh()
      else this.schedulePoll()
    })
    return this.inFlight
  }
  private async reconcile() {
    const generation = this.generation
    const signal = this.abort.signal
    const read = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
      readWithDeadline(signal, this.options.requestTimeoutMs ?? 10_000, operation)
    this.emit({ ...this.snapshot, phase: "syncing" })
    try {
      const sessions = new Map<string, Snapshot["sessions"][number]>()
      let cursor: string | undefined
      const cursors = new Set<string>()
      do {
        const page = await read((signal) => this.port.sessions(cursor, signal))
        if (this.disposed) return
        for (const session of page.data) sessions.set(session.id, session)
        cursor = page.next
        if (cursor && cursors.has(cursor)) throw new Error("repeated cursor")
        if (cursor) cursors.add(cursor)
        // Never show a full count or false empty while the index is partial.
        this.emit({ ...this.snapshot, phase: "partial" })
      } while (cursor !== undefined)
      const directories = [...new Set([...sessions.values()].map((session) => session.location.directory))]
      const pending: Pending[] = []
      const retainedKeys = new Set<string>()
      let index = 0
      let failed = false
      const failedDirectories = new Set<string>()
      await Promise.all(
        Array.from({ length: Math.min(4, directories.length) }, async () => {
          while (index < directories.length && !signal.aborted) {
            const directory = directories[index++]
            if (directory === undefined) break
            try {
              const result = await read((signal) => this.port.pending(directory, signal))
              if (this.disposed) return
              for (const [kind, items] of [
                ["permission", result.permissions],
                ["question", result.questions],
              ] as const) {
                for (const item of items) {
                  const key = `${kind}:${item.id}`
                  retainedKeys.add(key)
                  const since = this.firstSeen.get(key) ?? this.now()
                  this.firstSeen.set(key, since)
                  pending.push({ ...item, kind, since })
                }
              }
            } catch {
              failed = true
              failedDirectories.add(directory)
            }
          }
        }),
      )
      const running = await read((signal) => this.port.active(signal))
      if (this.disposed) return
      const changed = generation !== this.generation
      if (changed) this.dirty = true
      if (failed) {
        // Unknown pending state must not silently resolve a previously known badge.
        for (const item of this.snapshot.pending) {
          const session = sessions.get(item.sessionID)
          if (
            !retainedKeys.has(`${item.kind}:${item.id}`) &&
            session &&
            failedDirectories.has(session.location.directory)
          )
            pending.push(item)
        }
      } else if (!changed) {
        for (const key of this.firstSeen.keys()) if (!retainedKeys.has(key)) this.firstSeen.delete(key)
      }
      const orphaned = pending.some((item) => !sessions.has(item.sessionID))
      this.emit({
        sessions: [...sessions.values()],
        pending,
        running,
        // Publish progress during event storms without claiming it is current.
        phase: changed ? "stale" : failed || orphaned ? "partial" : "ready",
        updatedAt: this.now(),
      })
    } catch {
      this.emit({ ...this.snapshot, phase: "stale" })
    }
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort()
    this.stopEvents?.()
    if (this.timer) clearTimeout(this.timer)
    if (this.poll) clearTimeout(this.poll)
    this.listeners.clear()
    this.firstSeen.clear()
  }
}
