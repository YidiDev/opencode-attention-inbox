import { Plugin } from "@opencode/plugin"
import {
  SessionHistory,
  type SessionHistoryCheckInput,
  type SessionHistoryCheckOutput,
  type SessionHistorySettingsOutput,
} from "./rpc.js"
import { missingDirectories } from "./directory.js"

/**
 * Server-side plugin. Registers the `check` RPC so the TUI plugin can ask which
 * session directories no longer exist on the server's filesystem, and the
 * `settings` RPC because config options only reach this half of the plugin.
 *
 * The plugin runs in the server process, so it checks the real filesystem via
 * `node:fs`. Directories that are gone are reported as "missing" in the TUI —
 * not "deleted", which is a different state (the session record itself).
 *
 * The request is untrusted: `missingDirectories` drops non-strings, dedupes,
 * caps the list and bounds concurrency.
 */
export default Plugin.define({
  id: "session-history",
  async setup(ctx) {
    await ctx.rpc.register(SessionHistory, {
      check: async (input): Promise<SessionHistoryCheckOutput> => {
        const { directories } = input as SessionHistoryCheckInput
        if (!Array.isArray(directories)) return { missing: [] }
        return { missing: await missingDirectories(directories) }
      },
      // The TUI half receives an empty `context.options` for a plugin declared
      // in opencode.json; this is the only side that gets the configured values.
      settings: async (): Promise<SessionHistorySettingsOutput> => ({ options: { ...ctx.options } }),
    })
  },
})
