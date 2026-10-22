import { readWithDeadline } from "./deadline.js";

/** Optional server settings must not outlive setup or hold retries indefinitely. */
export function syncSettings(read, apply, timing = {}) {
  const abort = new AbortController();
  let retry;
  let attempts = 0;
  const load = async () => {
    try {
      const result = await readWithDeadline(abort.signal, timing.timeoutMs ?? 10_000, read);
      if (!abort.signal.aborted) apply(result.options);
    } catch (error) {
      if (!abort.signal.aborted && ++attempts < 15 && error?.type !== "rpc.method_not_found") {
        retry = setTimeout(() => void load(), timing.retryMs ?? 1000);
      }
    }
  };
  void load();
  return () => {
    abort.abort();
    if (retry) clearTimeout(retry);
  };
}