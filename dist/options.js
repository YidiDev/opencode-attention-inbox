/**
 * Pure helpers for the panel's configured `options`.
 *
 * OpenCode hands a plugin's config `options` to its server half but not to its
 * TUI half: the TUI context receives `{}` for a plugin declared in
 * `opencode.json`. The TUI therefore reads the values from the server over the
 * `settings` RPC and merges them over its own (usually empty) context options.
 *
 * Kept free of JSX and the OpenCode runtime so the merge can be unit-tested.
 */

/** The options the Session History panel understands, with defaults applied. */

export const DEFAULT_OPTIONS = {
  limit: 100,
  maxVisibleSessions: 3,
  truncateSessionTitles: true,
  showMetrics: true,
  showAllProjects: true
};

/**
 * Merge option sources (later wins) and fall back to {@link DEFAULT_OPTIONS}.
 * Values of the wrong type are ignored rather than coerced, so a malformed
 * config cannot silently flip a boolean or turn `limit` into a string.
 */
export function resolveOptions(...sources) {
  const raw = Object.assign({}, ...sources);
  return {
    limit: rowLimit(raw.limit) ?? DEFAULT_OPTIONS.limit,
    maxVisibleSessions: visibleRows(raw.maxVisibleSessions) ?? DEFAULT_OPTIONS.maxVisibleSessions,
    truncateSessionTitles: booleanValue(raw.truncateSessionTitles) ?? DEFAULT_OPTIONS.truncateSessionTitles,
    showMetrics: booleanValue(raw.showMetrics) ?? DEFAULT_OPTIONS.showMetrics,
    showAllProjects: booleanValue(raw.showAllProjects) ?? DEFAULT_OPTIONS.showAllProjects
  };
}
function booleanValue(value) {
  return typeof value === "boolean" ? value : undefined;
}
function rowLimit(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}
function visibleRows(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.floor(value));
}