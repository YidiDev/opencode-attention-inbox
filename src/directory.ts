import { stat } from "node:fs/promises"
import { MAX_DIRECTORIES } from "./rpc.js"

/** Most `stat` calls in flight at once, so a large request cannot spawn unbounded work. */
const CONCURRENCY = 32

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

/**
 * The subset of `directories` that no longer exists (or is not a directory).
 *
 * Input is untrusted: non-strings are dropped, duplicates are collapsed, the
 * list is capped at {@link MAX_DIRECTORIES}, and the checks run with bounded
 * concurrency. The result is sorted so it does not depend on scheduling.
 */
export async function missingDirectories(directories: readonly unknown[]): Promise<string[]> {
  const unique = [
    ...new Set(directories.filter((directory): directory is string => typeof directory === "string" && directory.length > 0)),
  ].slice(0, MAX_DIRECTORIES)

  const missing: string[] = []
  let cursor = 0
  const worker = async () => {
    for (let index = cursor++; index < unique.length; index = cursor++) {
      const directory = unique[index]
      if (directory === undefined) continue
      if (!(await directoryExists(directory))) missing.push(directory)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker))

  return missing.sort()
}
