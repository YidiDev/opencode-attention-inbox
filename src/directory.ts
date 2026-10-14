import { stat } from "node:fs/promises"

/**
 * Whether a session's working directory still exists on the server's
 * filesystem. Server-only: imported by the server plugin and never by the TUI
 * (the CLI runs in a different process, possibly a different machine).
 *
 * Fails open. Only a definitive "not there" (`ENOENT` / `ENOTDIR`) counts as
 * missing: macOS returns `EPERM` for protected directories, and a transient
 * error must not mark a live session as missing.
 */
export async function directoryExists(directory: unknown): Promise<boolean> {
  if (typeof directory !== "string" || directory.length === 0) return false
  try {
    return (await stat(directory)).isDirectory()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code !== "ENOENT" && code !== "ENOTDIR"
  }
}
