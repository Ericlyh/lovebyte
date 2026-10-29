import 'server-only';
import { cookies, headers } from 'next/headers';
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  isSessionId,
  newSessionId,
} from './session-id';

/**
 * Resolving the current session id (OOP-6716).
 *
 * The vocabulary lives in `session-id.ts`; this module adds the request
 * plumbing, which needs `next/headers` and therefore cannot be imported
 * by the edge proxy.
 */

/**
 * The session id for the current request.
 *
 * Order matters: the forwarded header first (it is present on the very
 * first request of a session, when the cookie is not yet stored), then
 * the cookie, then a fresh id.
 *
 * NOTE: this reads `headers()` and `cookies()`, so it opts the calling
 * render into dynamic mode. Do NOT call it from a prerendered page —
 * the landing page and /browse are prerendered once per locale
 * (OOP-6710) and a header read there would undo that. Page views are
 * recorded from the browser instead; see `src/components/analytics`.
 */
export async function resolveSessionId(): Promise<string> {
  // Both reads are best-effort. An analytics session id must never be
  // the reason a purchase fails, so a context without a request store
  // falls through to a fresh id instead of throwing.
  try {
    const h = await headers();
    const forwarded = h.get(SESSION_HEADER);
    if (isSessionId(forwarded)) return forwarded;
  } catch {
    // No request scope — fall through to the cookie.
  }

  try {
    const store = await cookies();
    const fromCookie = store.get(SESSION_COOKIE)?.value;
    if (isSessionId(fromCookie)) return fromCookie;
  } catch {
    // No request scope — fall through to a fresh id.
  }

  return newSessionId();
}

/**
 * The session id if the request already has one, without minting a new
 * one. Used by `/api/track`, which refuses a request that carries no
 * session — an analytics sink that invents its own sessions is an
 * analytics sink anyone can spam.
 */
export async function existingSessionId(): Promise<string | null> {
  try {
    const store = await cookies();
    const fromCookie = store.get(SESSION_COOKIE)?.value;
    if (isSessionId(fromCookie)) return fromCookie;
  } catch {
    // No request scope.
  }
  return null;
}
