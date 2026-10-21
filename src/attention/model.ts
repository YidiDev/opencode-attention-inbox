/** Deliberately excludes transcripts and request contents. */
export interface Session {
  id: string
  parentID?: string
  projectID: string
  title?: string
  location: { directory: string }
  outcome?: "succeeded" | "failed" | "interrupted"
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number }
}
export interface Pending {
  id: string
  sessionID: string
  kind: "permission" | "question"
  since: number
}
export interface Snapshot {
  sessions: readonly Session[]
  pending: readonly Pending[]
  running: ReadonlySet<string>
  phase: "syncing" | "ready" | "partial" | "stale"
  updatedAt?: number
}
export interface AttentionRow {
  session: Session
  permissions: number
  questions: number
  completedIdle?: number
  rank: number
  since: number
  parentTitle?: string
}
