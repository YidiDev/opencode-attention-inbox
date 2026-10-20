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
export interface PanelOptions {
  /** Maximum number of sessions included in the list. */
  limit: number
  /** Sessions visible before the list scrolls. */
  maxVisibleSessions: number
  /** Keep titles on one line with an ellipsis instead of wrapping. */
  truncateSessionTitles: boolean
  /** Show the "Xm ago · $Y.YY" line under a title. */
  showMetrics: boolean
  /** List sessions from every project, not just the current one. */
  showAllProjects: boolean
}

export const DEFAULT_OPTIONS: PanelOptions = {
  limit: 100,
  maxVisibleSessions: 3,
  truncateSessionTitles: true,
  showMetrics: true,
  showAllProjects: true,
}

/**
 * Merge option sources (later wins) and fall back to {@link DEFAULT_OPTIONS}.
 * Values of the wrong type are ignored rather than coerced, so a malformed
 * config cannot silently flip a boolean or turn `limit` into a string.
 */
export function resolveOptions(...sources: readonly Readonly<Record<string, unknown>>[]): PanelOptions {
  const raw = Object.assign({}, ...sources) as Record<string, unknown>
  return {
    limit: rowLimit(raw.limit) ?? DEFAULT_OPTIONS.limit,
    maxVisibleSessions: visibleRows(raw.maxVisibleSessions) ?? DEFAULT_OPTIONS.maxVisibleSessions,
    truncateSessionTitles:
      booleanValue(raw.truncateSessionTitles) ?? DEFAULT_OPTIONS.truncateSessionTitles,
    showMetrics: booleanValue(raw.showMetrics) ?? DEFAULT_OPTIONS.showMetrics,
    showAllProjects: booleanValue(raw.showAllProjects) ?? DEFAULT_OPTIONS.showAllProjects,
  }
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function rowLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.floor(value))
}

function visibleRows(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return Math.max(1, Math.floor(value))
}
