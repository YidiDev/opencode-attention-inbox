import { readWithDeadline } from "./deadline.js";
/** One setup-owned reconciler, not one fetch loop per sidebar mount. */
export class InboxController {
  snapshot = {
    sessions: [],
    pending: [],
    running: new Set(),
    phase: "syncing"
  };
  listeners = new Set();
  abort = new AbortController();
  firstSeen = new Map();
  generation = 0;
  dirty = false;
  disposed = false;
  constructor(port, options) {
    this.port = port;
    this.options = options;
    this.now = options.now ?? Date.now;
  }
  get current() {
    return this.snapshot;
  }
  setPollInterval(interval) {
    this.options.pollIntervalMs = interval;
    if (!this.inFlight) this.schedulePoll();
  }
  schedulePoll() {
    if (this.poll) clearTimeout(this.poll);
    if (!this.stopEvents || this.disposed) return;
    // Polling is a refresh request, not evidence that an in-flight read is old.
    // Start the delay after settling, so a slow scan cannot starve forever.
    this.poll = setTimeout(() => {
      this.poll = undefined;
      void this.refresh();
    }, this.options.pollIntervalMs);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }
  start() {
    if (this.stopEvents || this.disposed) return;
    // Subscribe before the first read. Events during a scan force another scan.
    this.stopEvents = this.port.listen(event => {
      if (event.request) {
        const key = `${event.request.kind}:${event.request.id}`;
        this.firstSeen.set(key, Math.min(this.firstSeen.get(key) ?? Infinity, event.request.created));
      }
      this.invalidate();
    });
    void this.refresh();
  }
  emit(snapshot) {
    if (this.disposed) return;
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
  invalidate() {
    if (this.disposed) return;
    this.generation++;
    this.dirty = true;
    this.emit({
      ...this.snapshot,
      phase: this.snapshot.updatedAt === undefined ? "syncing" : "stale"
    });
    // Leading-edge debounce: continuous events must not postpone a read forever.
    if (!this.timer && !this.inFlight) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.refresh();
      }, this.options.debounceMs ?? 200);
    }
  }
  refresh() {
    if (this.disposed) return Promise.resolve();
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.poll) {
      clearTimeout(this.poll);
      this.poll = undefined;
    }
    this.dirty = false;
    this.inFlight = this.reconcile().finally(() => {
      this.inFlight = undefined;
      if (this.dirty && !this.disposed) void this.refresh();else this.schedulePoll();
    });
    return this.inFlight;
  }
  async reconcile() {
    const generation = this.generation;
    const baseline = this.snapshot;
    const signal = this.abort.signal;
    let progressTimer;
    const read = operation => readWithDeadline(signal, this.options.requestTimeoutMs ?? 10_000, operation);
    this.emit({
      ...this.snapshot,
      phase: "syncing"
    });
    try {
      const sessions = new Map();
      let cursor;
      const cursors = new Set();
      do {
        const page = await read(signal => this.port.sessions(cursor, signal));
        if (this.disposed) return;
        for (const session of page.data) sessions.set(session.id, session);
        cursor = page.next;
        if (cursor && cursors.has(cursor)) throw new Error("repeated cursor");
        if (cursor) cursors.add(cursor);
        // Never show a full count or false empty while the index is partial.
        const phase = generation === this.generation ? "partial" : "stale";
        if (this.snapshot.phase !== phase) this.emit({
          ...this.snapshot,
          phase
        });
      } while (cursor !== undefined);
      const directories = [...new Set([...sessions.values()].map(session => session.location.directory))];
      const pending = [];
      const retainedKeys = new Set();
      const completedDirectories = new Set();
      // Retain already-observed completion evidence, but never infer a new
      // completion before the active-session read validates this inventory.
      const progressRunning = new Set(sessions.keys());
      for (const previous of baseline.sessions) {
        if (previous.outcome === "succeeded" && previous.time.idle === sessions.get(previous.id)?.time.idle && !baseline.running.has(previous.id)) progressRunning.delete(previous.id);
      }
      const publishProgress = () => {
        const retained = baseline.pending.filter(item => {
          const owner = sessions.get(item.sessionID);
          return owner && !completedDirectories.has(owner.location.directory) && !retainedKeys.has(`${item.kind}:${item.id}`);
        });
        this.emit({
          sessions: [...sessions.values()],
          pending: [...pending, ...retained],
          running: progressRunning,
          phase: generation === this.generation ? "partial" : "stale",
          updatedAt: this.now()
        });
      };
      let published = false;
      let progressDirty = false;
      const flushProgress = () => {
        if (progressTimer) clearTimeout(progressTimer);
        progressTimer = undefined;
        if (!progressDirty || this.disposed) return;
        progressDirty = false;
        published = true;
        publishProgress();
      };
      const queueProgress = () => {
        progressDirty = true;
        // Leading progress is immediate; subsequent results share one snapshot
        // per short window instead of re-deriving the entire inbox per directory.
        if (!published) flushProgress();else if (!progressTimer) progressTimer = setTimeout(flushProgress, 50);
      };
      let index = 0;
      let failed = false;
      const failedDirectories = new Set();
      await Promise.all(Array.from({
        length: Math.min(4, directories.length)
      }, async () => {
        while (index < directories.length && !signal.aborted) {
          const directory = directories[index++];
          if (directory === undefined) break;
          try {
            const result = await read(signal => this.port.pending(directory, signal));
            if (this.disposed) return;
            for (const [kind, items] of [["permission", result.permissions], ["question", result.questions]]) {
              for (const item of items) {
                const key = `${kind}:${item.id}`;
                retainedKeys.add(key);
                const since = this.firstSeen.get(key) ?? this.now();
                this.firstSeen.set(key, since);
                pending.push({
                  ...item,
                  kind,
                  since
                });
              }
            }
            completedDirectories.add(directory);
          } catch {
            failed = true;
            failedDirectories.add(directory);
          }
          queueProgress();
        }
      }));
      // Do not wait for active-session validation to reveal pending requests.
      flushProgress();
      const running = await read(signal => this.port.active(signal));
      if (this.disposed) return;
      const changed = generation !== this.generation;
      if (changed) this.dirty = true;
      if (failed) {
        // Unknown pending state must not silently resolve a previously known badge.
        for (const item of baseline.pending) {
          const session = sessions.get(item.sessionID);
          if (!retainedKeys.has(`${item.kind}:${item.id}`) && session && failedDirectories.has(session.location.directory)) pending.push(item);
        }
      } else if (!changed) {
        for (const key of this.firstSeen.keys()) if (!retainedKeys.has(key)) this.firstSeen.delete(key);
      }
      const orphaned = pending.some(item => !sessions.has(item.sessionID));
      this.emit({
        sessions: [...sessions.values()],
        pending,
        running,
        // Publish progress during event storms without claiming it is current.
        phase: changed ? "stale" : failed || orphaned ? "partial" : "ready",
        updatedAt: this.now()
      });
    } catch {
      this.emit({
        ...this.snapshot,
        phase: "stale"
      });
    } finally {
      if (progressTimer) clearTimeout(progressTimer);
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.stopEvents?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearTimeout(this.poll);
    this.listeners.clear();
    this.firstSeen.clear();
  }
}