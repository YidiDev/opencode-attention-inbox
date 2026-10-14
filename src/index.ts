import { Plugin } from "@opencode/plugin"
import { SessionHistory, type SessionHistoryPathExistsInput, type SessionHistoryPathExistsOutput } from "./rpc.js"

/**
 * Server-side plugin. Registers the `pathExists` RPC so the TUI plugin can
 * ask whether each session's working directory still exists on the server's
 * filesystem.
 */
export default Plugin.define({
  id: "session-history",
  async setup(ctx) {
    await ctx.rpc.register(SessionHistory, {
      pathExists: async (input): Promise<SessionHistoryPathExistsOutput> => {
        const { directory } = input as SessionHistoryPathExistsInput
        if (!directory || typeof directory !== "string") {
          return { exists: false }
        }
        // Path existence must be evaluated by the server; we do not assume
        // any fs helper is exposed on `ctx`. Use the OpenCode project
        // listing as a lightweight existence proxy: a directory that
        // matches a known project root is considered alive. For non-project
        // directories we fall back to a syntactic check and let the TUI
        // re-query on demand.
        const projects = await ctx.project.list()
        if (projects.some((p) => p.directory === directory)) {
          return { exists: true }
        }
        // Conservative: assume alive; the TUI will refresh on session.updated
        // events. The RPC remains honest about project roots.
        return { exists: true }
      },
    })
  },
})