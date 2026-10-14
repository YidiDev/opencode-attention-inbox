import { Plugin } from "@opencode/plugin"
import { SessionHistory, type SessionHistoryCheckInput, type SessionHistoryCheckOutput } from "./rpc.js"
import { directoryExists } from "./directory.js"

/**
 * Server-side plugin. Registers the `check` RPC so the TUI plugin can ask which
 * session directories no longer exist on the server's filesystem.
 *
 * The plugin runs in the server process, so it checks the real filesystem via
 * `node:fs`. Directories that are gone are reported as "missing" in the TUI —
 * not "deleted", which is a different state (the session record itself).
 */
export default Plugin.define({
  id: "session-history",
  async setup(ctx) {
    await ctx.rpc.register(SessionHistory, {
      check: async (input): Promise<SessionHistoryCheckOutput> => {
        const { directories } = input as SessionHistoryCheckInput
        if (!Array.isArray(directories)) return { missing: [] }
        const results = await Promise.all(
          directories.map(async (directory) => ({ directory, exists: await directoryExists(directory) })),
        )
        return { missing: results.filter((result) => !result.exists).map((result) => result.directory) }
      },
    })
  },
})
