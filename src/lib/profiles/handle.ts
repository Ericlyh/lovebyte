/**
 * Handle format + validation.
 *
 * Mirrors the DB-level CHECK constraint in
 * `supabase/migrations/0002_marketplace_v2.sql`:
 *   profiles_handle_fmt_chk: handle ~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$'
 *
 * Keep this regex in lockstep with the SQL — the DB is the source of
 * truth, this lib is just a friendlier surface for forms and tests.
 *
 * Scope (per OOP-4274 M-B spec):
 *   - 3–20 chars total
 *   - kebab-case (lowercase letters, digits, single dashes)
 *   - no leading or trailing dash
 *   - UNIQUE on `profiles.handle`
 *
 * The client uses `isValidHandle()` for live feedback; the server uses
 * `validateHandle()` and additionally probes the DB for uniqueness.
 */

export const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;

export type HandleFailureReason = 'too_short' | 'too_long' | 'format' | 'empty';

export type HandleValidation =
  | { ok: true; handle: string }
  | { ok: false; reason: HandleFailureReason };

/**
 * Cheap client-side check — runs on every keystroke for live feedback.
 * Does NOT probe the DB; uniqueness is a server-side check.
 */
export function isValidHandle(input: string): boolean {
  const normalized = normalizeHandle(input);
  if (normalized.length < HANDLE_MIN_LENGTH) return false;
  if (normalized.length > HANDLE_MAX_LENGTH) return false;
  return HANDLE_REGEX.test(normalized);
}

/**
 * Full server-side validation — returns a tagged result with reason.
 * Use this from server actions / API routes so the failure reason can
 * flow back to the form without parsing error strings.
 */
export function validateHandle(input: string | null | undefined): HandleValidation {
  if (!input) return { ok: false, reason: 'empty' };
  const normalized = normalizeHandle(input);
  if (normalized.length === 0) return { ok: false, reason: 'empty' };
  if (normalized.length < HANDLE_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (normalized.length > HANDLE_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (!HANDLE_REGEX.test(normalized)) return { ok: false, reason: 'format' };
  return { ok: true, handle: normalized };
}

/**
 * Lowercase + trim. Does NOT strip interior whitespace — that would
 * silently turn "first last" into "firstlast" without warning the user.
 * Stripping happens in the form layer (we render a hint on blur).
 */
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Human-readable reason text. Locale-keyed callers should translate
 * these via the i18n bundle; this is the fallback English copy used
 * when i18n isn't loaded (e.g. server logs).
 */
export function handleReasonText(reason: HandleFailureReason): string {
  switch (reason) {
    case 'empty':    return 'Pick a handle to continue.';
    case 'too_short':return `Handles need at least ${HANDLE_MIN_LENGTH} characters.`;
    case 'too_long': return `Handles can be at most ${HANDLE_MAX_LENGTH} characters.`;
    case 'format':   return 'Lowercase letters, digits, and dashes only. No leading or trailing dash.';
  }
}
