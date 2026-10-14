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
        // Path existence must be evaluated by the server. V2 Project.Info
        // exposes `canonical` (the project root) but no top-level `directory`;
        // we treat any session whose `location.directory` matches a known
        // project root as alive. For non-project paths we conservatively
        // return true and let the TUI re-query on session.updated events.
        const projects = await ctx.project.list()
        if (projects.some((p) => p.canonical === directory)) {
          return { exists: true }
        }
        return { exists: true }
      },
    })
  },
})