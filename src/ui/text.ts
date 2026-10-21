// Treat display strings as untrusted. Strip ANSI, controls and bidi overrides.
export function safeText(value: string): string {
  return value.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim()
}

export function truncate(value: string, width: number): string {
  const text = safeText(value)
  const limit = Math.max(0, Math.floor(width))
  if (!limit) return ""
  if (Bun.stringWidth(text) <= limit) return text
  if (limit <= 3) return ".".repeat(limit)
  let result = ""
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    if (Bun.stringWidth(result + segment) > limit - 3) break
    result += segment
  }
  return result + "..."
}

export function directoryLabel(directory: string): string {
  return safeText(directory.split("/").filter(Boolean).slice(-2).join("/"))
}
