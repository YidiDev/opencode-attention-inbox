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
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = setInterval(() => this.invalidate(), interval);
    }
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
    this.poll = setInterval(() => this.invalidate(), this.options.pollIntervalMs);
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, this.options.debounceMs ?? 200);
  }
  refresh() {
    if (this.disposed) return Promise.resolve();
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight;
    }
    this.dirty = false;
    this.inFlight = this.reconcile().finally(() => {
      this.inFlight = undefined;
      if (this.dirty && !this.disposed) void this.refresh();
    });
    return this.inFlight;
  }
  async reconcile() {
    const generation = this.generation;
    const signal = this.abort.signal;
    this.emit({
      ...this.snapshot,
      phase: "syncing"
    });
    try {
      const sessions = new Map();
      let cursor;
      const cursors = new Set();
      do {
        const page = await this.port.sessions(cursor, signal);
        if (this.disposed) return;
        for (const session of page.data) sessions.set(session.id, session);
        cursor = page.next;
        if (cursor && cursors.has(cursor)) throw new Error("repeated cursor");
        if (cursor) cursors.add(cursor);
        // Never show a full count or false empty while the index is partial.
        this.emit({
          ...this.snapshot,
          phase: "partial"
        });
      } while (cursor !== undefined);
      const directories = [...new Set([...sessions.values()].map(session => session.location.directory))];
      const pending = [];
      const retainedKeys = new Set();
      let index = 0;
      let failed = false;
      const failedDirectories = new Set();
      await Promise.all(Array.from({
        length: Math.min(4, directories.length)
      }, async () => {
        while (index < directories.length && !signal.aborted) {
          const directory = directories[index++];
          try {
            const result = await this.port.pending(directory, signal);
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
          } catch {
            failed = true;
            failedDirectories.add(directory);
          }
        }
      }));
      const running = await this.port.active(signal);
      if (this.disposed) return;
      if (generation !== this.generation) {
        this.dirty = true;
        return;
      }
      if (failed) {
        // Unknown pending state must not silently resolve a previously known badge.
        for (const item of this.snapshot.pending) {
          const session = sessions.get(item.sessionID);
          if (!retainedKeys.has(`${item.kind}:${item.id}`) && session && failedDirectories.has(session.location.directory)) pending.push(item);
        }
      } else {
        for (const key of this.firstSeen.keys()) if (!retainedKeys.has(key)) this.firstSeen.delete(key);
      }
      const orphaned = pending.some(item => !sessions.has(item.sessionID));
      this.emit({
        sessions: [...sessions.values()],
        pending,
        running,
        phase: failed || orphaned ? "partial" : "ready",
        updatedAt: this.now()
      });
    } catch {
      this.emit({
        ...this.snapshot,
        phase: "stale"
      });
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.stopEvents?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.poll) clearInterval(this.poll);
    this.listeners.clear();
    this.firstSeen.clear();
  }
}