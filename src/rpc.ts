import { Rpc } from "@opencode/plugin/rpc"

/**
 * Most directories accepted in a single `check` call. The TUI sends one entry
 * per distinct session directory (bounded by its own fetch cap), so this is
 * headroom; it exists to bound the work a caller can request.
 */
export const MAX_DIRECTORIES = 1000

/**
 * Single-method RPC used by the TUI plugin to ask the server which session
 * directories no longer exist on disk.
 *
 * Batched: one call covers every distinct directory. The check runs on the
 * server, so it also holds when the TUI is connected to a remote server, and it
 * is not limited to the location the plugin happens to be loaded at.
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
  },
  events: {},
})

export type SessionHistoryCheckInput = { directories: string[] }
export type SessionHistoryCheckOutput = { missing: string[] }
