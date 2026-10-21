/** Bound reads even if an adapter fails to reject on abort. Never retry effects. */
export async function readWithDeadline(parent, milliseconds, read) {
  const child = new AbortController();
  const abort = () => child.abort(parent.reason);
  if (parent.aborted) abort();else parent.addEventListener("abort", abort, {
    once: true
  });
  const timer = setTimeout(() => child.abort(new Error("Inbox read timed out")), milliseconds);
  const cancelled = Promise.withResolvers();
  const rejectAbort = () => cancelled.reject(child.signal.reason);
  child.signal.addEventListener("abort", rejectAbort, {
    once: true
  });
  if (child.signal.aborted) rejectAbort();
  try {
    return await Promise.race([cancelled.promise, Promise.resolve().then(() => {
      child.signal.throwIfAborted();
      return read(child.signal);
    })]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
    child.signal.removeEventListener("abort", rejectAbort);
  }
}