/**
 * The `?next=` return path — a same-origin path guard.
 *
 * `ReplyForm` has always linked to `/login?next=…` so a visitor comes
 * back to where they were after signing in. The parameter was never
 * plumbed through, so signing in dropped the visitor on the home page.
 * That matters most on the recipient surface (OOP-6718): a recipient
 * who signs in to write back would land on the home page with the gift
 * gone.
 *
 * A return path is attacker-controlled, so it is treated as untrusted
 * input. Only a same-origin absolute PATH is accepted. The check runs
 * through the WHATWG URL parser rather than a hand-rolled regex,
 * because the parser is what the BROWSER will use to resolve the
 * redirect — it normalises the same encodings and backslash tricks the
 * browser does, so anything that resolves to another host is caught.
 */

/** A fixed origin used only to resolve relative paths. Never navigated to. */
const RESOLVE_BASE = 'https://next.invalid';

/**
 * Sanitize a `?next=` value.
 *
 * Returns the safe path, or null when the value is absent or points
 * somewhere else. Callers treat null as "no return path" and fall back
 * to their default destination.
 */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  const value = raw.trim();
  if (!value) return null;
  // A path is absolute, not protocol-relative and not a full URL.
  if (!value.startsWith('/')) return null;

  let url: URL;
  try {
    url = new URL(value, RESOLVE_BASE);
  } catch {
    return null;
  }

  // The parser resolved it against a different host — `//evil.com`,
  // `/\evil.com` and their encoded spellings all land here.
  if (url.origin !== RESOLVE_BASE) return null;

  // Path + query + hash only. The origin is dropped and rebuilt by the
  // caller, so the returned value can never name a host.
  return `${url.pathname}${url.search}${url.hash}`;
}
