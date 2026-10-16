/**
 * Pure helpers behind the Session History panel. Kept free of JSX and the
 * OpenCode runtime so they can be unit-tested directly (see tests/run.ts).
 */

/**
 * Scope sessions to the current project: a session belongs when its working
 * directory matches the current root or a known project's canonical root.
 */
export function scopeToCurrentProject(sessions, currentRoot, projects) {
  return sessions.filter(s => s.location.directory === currentRoot || projects.some(p => p.canonical === s.location.directory));
}

/**
 * Merge the server-wide index with the reactive cache, keyed by session id.
 * The cache wins so live title/cost/status changes for the current location
 * are reflected without waiting for the next index refresh.
 */
export function mergeSessions(remote, cached) {
  const byId = new Map();
  for (const s of remote) byId.set(s.id, s);
  for (const s of cached) byId.set(s.id, s);
  return [...byId.values()];
}

/**
 * Apply the search filter, drop subagent children and archived sessions, and
 * sort newest first. The caller caps the result to the configured limit.
 *
 * The query matches a session's title, id, working directory, or its project's
 * canonical root / display name — so sessions can be found by project or
 * directory even when the working directory differs (worktrees, subpaths).
 */
export function filterSessions(sessions, query, projects = []) {
  const q = query.trim().toLowerCase();
  const projectText = new Map();
  for (const p of projects) {
    projectText.set(p.id, [p.canonical, p.name ?? ""].map(text => text.toLowerCase()));
  }
  const matched = q ? sessions.filter(s => (s.title ?? "").toLowerCase().includes(q) || s.id.toLowerCase().includes(q) || s.location.directory.toLowerCase().includes(q) || (projectText.get(s.projectID)?.some(text => text.includes(q)) ?? false)) : sessions;
  return matched.filter(s => !s.parentID && !s.time.archived).slice().sort((a, b) => b.time.updated - a.time.updated);
}

/** Short project hint (last path segment) so cross-project rows are distinguishable. */
export function projectLabel(directory) {
  const parts = directory.split("/").filter(Boolean);
  return parts.at(-1) ?? directory;
}

/** Width the CLI gives its session sidebar, so the home panel matches it. */
export const HOME_PANEL_MAX_WIDTH = 42;
/** Horizontal budget the centered home screen needs (prompt `maxWidth` 75 + margin). */
export const HOME_CONTENT_WIDTH = 76;
/** Narrower than this and a panel is not worth the space. */
export const HOME_PANEL_MIN_WIDTH = 22;

/**
 * Width of the session panel shown on the home screen, or 0 when it would
 * overlap the centered home content. The CLI centers that content in the full
 * frame, so the panel can only occupy the right margin: `(width - content) / 2`.
 */
export function homePanelWidth(terminalWidth) {
  const width = Math.min(HOME_PANEL_MAX_WIDTH, Math.floor((terminalWidth - HOME_CONTENT_WIDTH) / 2));
  return width >= HOME_PANEL_MIN_WIDTH ? width : 0;
}