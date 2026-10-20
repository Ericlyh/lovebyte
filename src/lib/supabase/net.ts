/**
 * Network policy for every Supabase request the app makes (OOP-5816).
 *
 * Why this module exists
 * ----------------------
 * When the Supabase project host stopped resolving, every SSR read that
 * went through the supabase-js client took 7.3 seconds to fail, and
 * `/browse` rendered as a blank white page for 6.5 of those seconds.
 *
 * The network was never the problem — the DNS lookup failed in ~3ms. The
 * problem was `@supabase/postgrest-js`'s retry policy: it retries an
 * idempotent request up to 3 times with 1s / 2s / 4s of backoff, and it
 * cannot tell "the host is unreachable" (permanent) from "the host is
 * briefly unavailable" (transient). Three retries of a 3ms failure is
 * 7 seconds of dead time on every request that touches the database.
 *
 * Two rules, applied here so every caller gets them:
 *
 *   1. **An unreachable host fails immediately.** The error is re-thrown
 *      as an `AbortError` — the one error postgrest-js does NOT retry
 *      (`fetchWithRetry` rethrows AbortError before it considers a
 *      retry). 503/520 responses still get their upstream retries,
 *      because those genuinely are transient.
 *   2. **Every request has a deadline.** A hung request must not be able
 *      to hold a page render open forever. Reads get a tight one; writes
 *      get a looser one; Storage uploads get none, because a 50MB video
 *      is a legitimate multi-minute request.
 *
 * The deadline is what makes rule 1 runtime-independent. The Node
 * runtime reports an unresolvable host as `ENOTFOUND` within ~3ms, so
 * rule 1 catches it. The edge runtime hangs on the same lookup for
 * ~7 seconds and reports it with a different error shape, so there the
 * deadline is what bounds the damage. Both paths end at the same place:
 * an `AbortError`, which postgrest-js does not retry.
 *
 * The plain `fetch` helper in `anon.ts` has no retry layer, but it gets
 * the deadline for the same reason.
 */

/**
 * Deadline for read requests (GET/HEAD). A read that takes longer than
 * this is broken; the pages that depend on it all degrade gracefully
 * (empty catalog, "status unknown") rather than hanging.
 */
export const READ_DEADLINE_MS = Number(
  process.env.SUPABASE_READ_TIMEOUT_MS ?? 2000,
);

/**
 * Deadline for writes (POST/PATCH/PUT to PostgREST). Looser than a read
 * because a write may wait on a lock or a trigger.
 */
export const WRITE_DEADLINE_MS = Number(
  process.env.SUPABASE_WRITE_TIMEOUT_MS ?? 10000,
);

/**
 * Network-level failures that mean "the host is not there". These are
 * the ones worth short-circuiting: no amount of retrying will make an
 * unresolvable hostname resolve.
 *
 * Deliberately excluded: `ECONNRESET`, `EPIPE`, `ETIMEDOUT` — those can
 * be transient mid-request failures, and upstream's retry handles them.
 */
const UNREACHABLE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  if (cause?.code) return cause.code;
  return (err as { code?: string } | null)?.code ?? undefined;
}

/**
 * True when the failure means the host could not be reached at all.
 *
 * An `AbortError` is NOT "unreachable" — that is our own deadline
 * firing, and it must not be re-wrapped.
 */
export function isUnreachable(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name;
  if (name === 'AbortError') return false;
  return UNREACHABLE_CODES.has(errorCode(err) ?? '');
}

/**
 * Re-wrap a network failure as an `AbortError` so postgrest-js stops
 * retrying it. The original error is kept as `cause` for logs.
 */
export function unreachableError(err: unknown): Error {
  const code = errorCode(err) ?? 'UNKNOWN';
  const wrapped = new DOMException(
    `Supabase host unreachable (${code})`,
    'AbortError',
  ) as Error & { cause?: unknown };
  wrapped.cause = err;
  return wrapped;
}

/**
 * Combine the caller's signal with a deadline. `AbortSignal.any` is
 * available in Node 20+ and the edge runtime; the fallback keeps the
 * caller's signal alone rather than silently dropping it.
 */
function withDeadline(
  signal: AbortSignal | null | undefined,
  ms: number,
): AbortSignal {
  const deadline = AbortSignal.timeout(ms);
  if (!signal) return deadline;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, deadline]);
  }
  return signal;
}

/**
 * Storage uploads are exempt from the deadline: a 50MB video on a slow
 * link is a legitimate multi-minute request, and cutting it off would
 * look to the user like a failed upload.
 */
function isUpload(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/storage/v1/');
}

/**
 * A deadline error shaped like an abort, so postgrest-js rethrows it
 * instead of retrying it.
 */
function deadlineError(ms: number, method: string): Error {
  const message = `Supabase ${method} exceeded the ${ms}ms deadline`;
  const err = new DOMException(message, 'AbortError') as Error & { cause?: unknown };
  err.cause = new Error(message);
  return err;
}

/**
 * Bound how long a caller WAITS for a request, independently of whether
 * the underlying fetch can be cancelled.
 *
 * This is the runtime-independent half of the deadline. The abort
 * signal alone is not enough: the edge runtime resolves DNS in a way
 * that does not observe the signal, so an aborted fetch there still
 * waits the full ~8 seconds for the lookup to give up. Racing the
 * request against a timer bounds the caller's wait no matter what the
 * runtime does with the signal. The losing promise is still awaited by
 * `Promise.race`, so a later rejection is handled rather than unhandled.
 */
function softDeadline<T>(
  request: Promise<T>,
  ms: number,
  method: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(deadlineError(ms, method)), ms);
  });
  return Promise.race([request, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * The `fetch` every Supabase client in this app uses.
 *
 * Pass it as `global: { fetch: supabaseFetch }` to the supabase-js
 * client factories, or call it directly from the `fetch`-based helpers.
 */
export function supabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const deadline = isUpload(input)
    ? null
    : isRead
      ? READ_DEADLINE_MS
      : WRITE_DEADLINE_MS;
  const signal = deadline === null ? init?.signal : withDeadline(init?.signal, deadline);

  const request = fetch(input, { ...init, signal }).catch((err: unknown) => {
    if (isUnreachable(err)) throw unreachableError(err);
    throw err;
  });

  if (deadline === null) return request;
  return softDeadline(request, deadline, method);
}
