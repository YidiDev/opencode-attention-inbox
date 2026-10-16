import { Plugin } from "@opencode/plugin";
import { SessionHistory } from "./rpc.js";
import { missingDirectories } from "./directory.js";

/**
 * Server-side plugin. Registers the `check` RPC so the TUI plugin can ask which
 * session directories no longer exist on the server's filesystem.
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
      check: async input => {
        const {
          directories
        } = input;
        if (!Array.isArray(directories)) return {
          missing: []
        };
        return {
          missing: await missingDirectories(directories)
        };
      }
    });
  }
});