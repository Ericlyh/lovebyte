/**
 * Password rule helpers (client-safe, no React).
 *
 * Mirrors the Supabase + server-side limits used by `signUpAction`:
 *   - at least 8 characters
 *   - at most 72 characters (Supabase hard limit, see
 *     `src/lib/actions/auth.ts::passwordSchema`)
 *
 * The signup form renders `checkPasswordRules(pwd)` as a live checklist so
 * the user sees each requirement flip from "pending" to "ok" as they type,
 * instead of discovering the failure server-side after submit.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export type PasswordRuleId = 'min_length' | 'max_length';

export type PasswordRule = {
  id: PasswordRuleId;
  ok: boolean;
};

export function checkPasswordRules(pwd: string): PasswordRule[] {
  const length = pwd.length;
  return [
    { id: 'min_length', ok: length >= PASSWORD_MIN_LENGTH },
    // Don't warn about the upper limit until the user has typed at least
    // one character — an empty field should only show "needs 8+", not
    // also "too long".
    { id: 'max_length', ok: length === 0 || length <= PASSWORD_MAX_LENGTH },
  ];
}

export function isPasswordOk(pwd: string): boolean {
  return checkPasswordRules(pwd).every((r) => r.ok);
}
