import { statusLabel } from "../attention/derive.js";
import { directoryLabel, safeText, truncate, truncateTail } from "./text.js";

/** Shared by the sidebar and hidden-sidebar picker: unknown is never empty. */
export function inboxHealth(phase, count, scope, projectKnown) {
  if (scope === "project" && !projectKnown) return "Resolving current project...";
  switch (phase) {
    case "syncing":
      return "Syncing...";
    case "partial":
      return "Partial · still checking";
    case "stale":
      return "Stale · refresh to retry";
    case "ready":
      return count ? "" : "Nothing needs attention";
  }
}
export function rowContext(row, width = 80) {
  const limit = Math.max(0, Math.floor(width));
  if (limit < 24) return truncateTail(directoryLabel(row.session.location.directory), limit);
  const project = truncate(row.session.projectID.slice(0, 8), Math.floor(limit / 4));
  const parent = row.session.parentID && limit >= 24 ? ` · ${truncate(`child of ${safeText(row.parentTitle ?? row.session.parentID)}`, Math.min(26, Math.floor(limit / 3)))}` : "";
  const pathWidth = Math.max(0, limit - Bun.stringWidth(project + parent) - 3);
  const path = truncateTail(directoryLabel(row.session.location.directory), pathWidth);
  // Project and worktree get independent budgets; a long parent cannot erase either.
  return truncate(`${project} · ${path}${parent}`, limit);
}
export function pickerOptions(rows) {
  return rows.map(row => ({
    value: row.session.id,
    title: safeText(row.session.title?.trim() || "Untitled session"),
    description: `${statusLabel(row)} · ${rowContext(row)}`
  }));
}

/** Compact tab-like indicators; complete request counts remain in the picker. */
export function rowIndicator(row) {
  return `${row.permissions ? "!" : ""}${row.questions ? "?" : ""}${row.completedIdle !== undefined ? "●" : ""}`;
}
export function rowTitle(row, width, showContext = false) {
  const title = safeText(row.session.title?.trim() || "Untitled session");
  if (!showContext || width < 20) return truncate(title, width);
  const directory = directoryLabel(row.session.location.directory).split("/").at(-1) || "/";
  const hint = truncateTail(`${row.session.projectID.slice(0, 6)}/${directory === "/" ? "" : directory}`, Math.min(14, Math.floor(width / 3)));
  return `${truncate(title, width - Bun.stringWidth(hint) - 3)} · ${hint}`;
}

/** Fixed-height virtual list, with one row of overscan on either side. */
export function rowWindow(ids, scrollTop, visibleRows) {
  const start = Math.max(0, Math.min(Math.floor(scrollTop) - 1, Math.max(0, ids.length - visibleRows)));
  const end = Math.min(ids.length, start + visibleRows + 2);
  return {
    ids: ids.slice(start, end),
    before: start,
    after: ids.length - end
  };
}