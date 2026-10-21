import type { Session } from "../attention/model.js"

export interface Invalidation {
  request?: { id: string; kind: "permission" | "question"; created: number }
}
export interface InboxPort {
  sessions(cursor: string | undefined, signal: AbortSignal): Promise<{ data: Session[]; next?: string }>
  pending(
    directory: string,
    signal: AbortSignal,
  ): Promise<{
    permissions: { id: string; sessionID: string }[]
    questions: { id: string; sessionID: string }[]
  }>
  active(signal: AbortSignal): Promise<ReadonlySet<string>>
  listen(handler: (event: Invalidation) => void): () => void
}
