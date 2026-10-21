import type { AttentionRow, Pending, Snapshot } from "./model.js"
import type { Scope } from "../options.js"

export function deriveRows(snapshot: Snapshot, includeChildren = false): AttentionRow[] {
  const pending = new Map<string, Pending[]>()
  // The actual owner, not its parent, owns the badge. Deduplicate API repeats.
  const seen = new Set<string>()
  for (const item of snapshot.pending) {
    const key = `${item.kind}:${item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const items = pending.get(item.sessionID) ?? []
    items.push(item)
    pending.set(item.sessionID, items)
  }
  const sessions = new Map(snapshot.sessions.map(session => [session.id, session]))
  const rows: AttentionRow[] = []
  for (const session of sessions.values()) {
    const items = pending.get(session.id) ?? []
    const permissions = items.filter(item => item.kind === "permission")
    const questions = items.filter(item => item.kind === "question")
    const idle = session.time.idle
    const completedIdle = session.outcome === "succeeded" && idle !== undefined &&
      idle > (session.time.viewed ?? 0) && !snapshot.running.has(session.id) &&
      (includeChildren || !session.parentID) && session.time.archived === undefined ? idle : undefined
    if (!items.length && completedIdle === undefined) continue
    const rank = permissions.length ? 0 : questions.length ? 1 : 2
    const waiting = rank === 0 ? permissions : questions
    rows.push({
      session, permissions: permissions.length, questions: questions.length, completedIdle, rank,
      since: waiting.length ? Math.min(...waiting.map(item => item.since)) : completedIdle!,
      parentTitle: session.parentID ? sessions.get(session.parentID)?.title : undefined,
    })
  }
  return rows.sort((a, b) => a.rank - b.rank ||
    (a.rank === 2 ? b.since - a.since : a.since - b.since) || a.session.id.localeCompare(b.session.id))
}

export function scopeRows(rows: readonly AttentionRow[], scope: Scope, projectID?: string): AttentionRow[] {
  return rows.filter(row => scope === "all" || (projectID !== undefined && row.session.projectID === projectID))
}

export function statusLabel(row: AttentionRow): string {
  return [row.permissions ? `Permission${row.permissions > 1 ? ` ×${row.permissions}` : ""}` : "",
    row.questions ? `Question${row.questions > 1 ? ` ×${row.questions}` : ""}` : "",
    row.completedIdle !== undefined ? "Done · unread" : ""].filter(Boolean).join(" · ")
}
