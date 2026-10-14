import { Rpc } from "@opencode/plugin/rpc"

/**
 * Single-method RPC used by the TUI plugin to ask the server whether a given
 * directory still exists on disk. The TUI may run against a remote server,
 * so we cannot stat paths locally.
 */
export const SessionHistory = Rpc.define({
  id: "session-history",
  methods: {
    pathExists: {
      input: {
        type: "object",
        properties: { directory: { type: "string" } },
        required: ["directory"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { exists: { type: "boolean" } },
        required: ["exists"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})

export type SessionHistoryPathExistsInput = { directory: string }
export type SessionHistoryPathExistsOutput = { exists: boolean }