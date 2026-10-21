import { Rpc } from "@opencode/plugin/rpc"

/** Compatibility bridge for options supplied to the server half. No session data. */
export const AttentionInbox = Rpc.define({
  id: "attention-inbox",
  methods: {
    settings: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: {
        type: "object",
        properties: { options: { type: "object", additionalProperties: true } },
        required: ["options"], additionalProperties: false,
      },
    },
  },
  events: {},
})
