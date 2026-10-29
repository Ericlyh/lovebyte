/**
 * The anonymous session id — the pure parts (OOP-6716).
 *
 * Kept separate from `session.ts` because the EDGE PROXY needs these
 * constants and helpers, and `session.ts` imports `next/headers`, which
 * does not exist in the proxy's runtime.
 *
 * Every event carries a session id, so a funnel can be read as "how
 * many people reached step N" rather than "how many clicks happened".
 * It is a random uuid with no relationship to a user account, an IP
 * address or a device — a correlation handle, nothing more.
 *
 * Two ways it reaches the server:
 *
 *   1. `lb-sid` — an httpOnly cookie set by the proxy (src/proxy.ts) on
 *      the visitor's first page request. `httpOnly` means the browser
 *      cannot read it, so a page script cannot read another visitor's
 *      session id, and the client-side reporter never handles it at
 *      all: it POSTs to `/api/track` and the SERVER derives the session
 *      from the cookie.
 *
 *   2. `x-lb-sid` — the same value, forwarded by the proxy as a
 *      request header. This exists for the first request of a session:
 *      the proxy sets the cookie on the RESPONSE, so the request that
 *      renders the page does not carry it yet. Without the header, the
 *      first server-side event of a session would be filed under a
 *      throwaway id and would not join the visitor's other steps.
 *
 * The proxy overwrites the header on every request, so a client cannot
 * forge it — but the shape is validated anyway, because the value
 * becomes part of a storage object name.
 */

/** Cookie the proxy sets. Mirrors the `lb-locale` cookie next to it. */
export const SESSION_COOKIE = 'lb-sid';

/** Header the proxy forwards the same value in. */
export const SESSION_HEADER = 'x-lb-sid';

/** How long a session id lives. Matches the locale cookie. */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a well-formed session id. */
export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Mint a new session id. */
export function newSessionId(): string {
  return crypto.randomUUID();
}
