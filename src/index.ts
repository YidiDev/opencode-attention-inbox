import { Plugin } from "@opencode/plugin"
import { SessionHistory, type SessionHistoryPathExistsInput, type SessionHistoryPathExistsOutput } from "./rpc.js"

/**
 * Server-side plugin. Registers the `pathExists` RPC so the TUI plugin can
 * ask whether each session's working directory still exists on the server's
 * filesystem.
 *
 * V2's server-side plugin context exposes no direct filesystem API. We
 * conservatively return `exists: true` for any non-empty absolute path; the
 * TUI marks rows as stale when OpenCode itself removes the session or when
 * the user closes the project. Future versions can replace this with a real
 * fs.stat when OpenCode exposes one on the plugin context.
 */
export default Plugin.define({
  id: "session-history",
  async setup(ctx) {
    await ctx.rpc.register(SessionHistory, {
      pathExists: async (input): Promise<SessionHistoryPathExistsOutput> => {
        const { directory } = input as SessionHistoryPathExistsInput
        if (!directory || typeof directory !== "string" || directory.length === 0) {
          return { exists: false }
        }
        // No server-side fs in V2 plugin context; treat any non-empty
        // absolute path as alive. The TUI rerenders on session lifecycle
        // events, which is the authoritative source of staleness.
        void ctx
        return { exists: true }
      },
    })
  },
})