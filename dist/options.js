export function resolveOptions(...sources) {
  const raw = Object.assign({}, ...sources);
  const number = (key, fallback, min, max) => {
    const value = raw[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
  };
  return {
    defaultScope: raw.defaultScope === "all" ? "all" : "project",
    maxVisibleRows: number("maxVisibleRows", 4, 1, 8),
    pollIntervalMs: number("pollIntervalMs", 30_000, 5_000, 300_000),
    includeChildCompletions: raw.includeChildCompletions === true
  };
}