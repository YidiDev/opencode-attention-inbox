import { Rpc } from "@opencode/plugin/rpc"

/**
 * Most directories accepted in a single `check` call. The TUI sends one entry
 * per distinct session directory (bounded by its own fetch cap), so this is
 * headroom; it exists to bound the work a caller can request.
 */
export const MAX_DIRECTORIES = 1000

/**
 * RPC used by the TUI plugin for two server-owned answers:
 *
 * - `check`: which session directories no longer exist on disk.
 * - `settings`: the plugin's configured `options`.
 *
 * Both run on the server, so they also hold when the TUI is connected to a
 * remote server, and they are not limited to the location the plugin happens
 * to be loaded at.
 */
export const SessionHistory = Rpc.define({
  id: "session-history",
  methods: {
    check: {
      input: {
        type: "object",
        properties: {
          directories: { type: "array", items: { type: "string" }, maxItems: MAX_DIRECTORIES },
        },
        required: ["directories"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          missing: { type: "array", items: { type: "string" } },
        },
        required: ["missing"],
        additionalProperties: false,
      },
    },
    /**
     * The plugin's configured options.
     *
     * OpenCode passes config `options` to the server half only, so this is how
     * the TUI half learns about them.
     */
    settings: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          options: { type: "object", additionalProperties: true },
        },
        required: ["options"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})

export type SessionHistoryCheckInput = { directories: string[] }
export type SessionHistoryCheckOutput = { missing: string[] }
export type SessionHistorySettingsOutput = { options: Readonly<Record<string, unknown>> }
