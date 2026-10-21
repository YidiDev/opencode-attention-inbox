import { statusLabel } from "../attention/derive.js"
import type { AttentionRow, Snapshot } from "../attention/model.js"
import type { Scope } from "../options.js"
import { directoryLabel, safeText, truncateTail } from "./text.js"

/** Shared by the sidebar and hidden-sidebar picker: unknown is never empty. */
export function inboxHealth(
  phase: Snapshot["phase"],
  count: number,
  scope: Scope,
  projectKnown: boolean,
): string {
  if (scope === "project" && !projectKnown) return "Resolving current project..."
  switch (phase) {
    case "syncing":
      return "Syncing..."
    case "partial":
      return "Partial · still checking"
    case "stale":
      return "Stale · refresh to retry"
    case "ready":
      return count ? "" : "Nothing needs attention"
  }
}

export function rowContext(row: AttentionRow, width = 80): string {
  const parent = row.session.parentID
    ? ` · child of ${safeText(row.parentTitle ?? row.session.parentID)}`
    : ""
  // Keep the directory's distinguishing tail, not just a common path prefix.
  return truncateTail(
    `${row.session.projectID.slice(0, 8)} · ${directoryLabel(row.session.location.directory)}${parent}`,
    width,
  )
}

export function pickerOptions(rows: readonly AttentionRow[]) {
  return rows.map((row) => ({
    value: row.session.id,
    title: safeText(row.session.title?.trim() || "Untitled session"),
    description: `${statusLabel(row)} · ${rowContext(row)}`,
  }))
}

/** Fixed-height virtual list, with one row of overscan on either side. */
export function rowWindow(ids: readonly string[], scrollTop: number, visibleRows: number) {
  const start = Math.max(0, Math.min(Math.floor(scrollTop / 3) - 1, Math.max(0, ids.length - visibleRows)))
  const end = Math.min(ids.length, start + visibleRows + 2)
  return { ids: ids.slice(start, end), before: start * 3, after: (ids.length - end) * 3 }
}
