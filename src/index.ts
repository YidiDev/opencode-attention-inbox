import { Plugin } from "@opencode/plugin"
import { SessionHistory, type SessionHistoryPathExistsInput, type SessionHistoryPathExistsOutput } from "./rpc.js"
import { directoryExists } from "./directory.js"

/**
 * Server-side plugin. Registers the `pathExists` RPC so the TUI plugin can ask
 * whether each session's working directory still exists on the server's
 * filesystem.
 *
 * The plugin runs in the server process, so it checks the real filesystem via
 * `node:fs`. Sessions whose directory is gone are surfaced as "missing" in the
 * TUI — not "deleted", which is a different state (the session record itself).
 */
export default Plugin.define({
  id: "session-history",
  async setup(ctx) {
    await ctx.rpc.register(SessionHistory, {
      pathExists: async (input): Promise<SessionHistoryPathExistsOutput> => {
        const { directory } = input as SessionHistoryPathExistsInput
        return { exists: await directoryExists(directory) }
      },
    })
  },
})
