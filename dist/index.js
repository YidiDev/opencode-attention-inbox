import { Plugin } from "@opencode/plugin";
import { resolveOptions } from "./options.js";
import { AttentionInbox } from "./rpc.js";
export default Plugin.define({
  id: "attention-inbox",
  async setup(ctx) {
    await ctx.rpc.register(AttentionInbox, {
      settings: async () => ({
        options: {
          ...resolveOptions(ctx.options)
        }
      })
    });
  }
});