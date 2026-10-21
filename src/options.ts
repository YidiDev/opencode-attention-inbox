export type Scope = "project" | "all"
export interface Options {
  defaultScope: Scope
  maxVisibleRows: number
  pollIntervalMs: number
  includeChildCompletions: boolean
}

export function resolveOptions(...sources: (Readonly<Record<string, unknown>> | undefined)[]): Options {
  const raw = Object.assign({}, ...sources)
  const number = (key: string, fallback: number, min: number, max: number) => {
    const value = raw[key]
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.floor(value)))
      : fallback
  }
  return {
    defaultScope: raw.defaultScope === "all" ? "all" : "project",
    maxVisibleRows: number("maxVisibleRows", 4, 1, 8),
    pollIntervalMs: number("pollIntervalMs", 30_000, 5_000, 300_000),
    includeChildCompletions: raw.includeChildCompletions === true,
  }
}
