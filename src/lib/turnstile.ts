import 'server-only';

/**
 * Cloudflare Turnstile verification for the waitlist form (OOP-6161).
 *
 * Why this exists
 * ---------------
 * `joinWaitlistAction` rate-limits by hashed IP + UA (one submission
 * per hour per fingerprint). That is a *volume* control, not an
 * *identity* control: a bot rotating source IPs walks straight through
 * it. Turnstile is the identity control — the browser proves it can
 * run Cloudflare's challenge, and the server checks that proof against
 * Cloudflare.
 *
 * Why it is dormant by default
 * ----------------------------
 * The launch checklist (§1) says CAPTCHA goes in "when we see real bot
 * pressure; closed-beta traffic doesn't warrant it today". So the whole
 * gate is keyed off ONE env var, `TURNSTILE_SECRET_KEY`:
 *
 *   - unset   → `verifyTurnstileToken` returns `{ ok: true }` without
 *                making a network call, and the widget is not rendered.
 *                The waitlist behaves exactly as it did before.
 *   - set     → the token is REQUIRED, and verification fails closed.
 *
 * That means turning the gate on is an env-var change plus a redeploy —
 * no code change, no risk of half-wired CAPTCHA. The operator also
 * needs `NEXT_PUBLIC_TURNSTILE_SITE_KEY` for the widget to render; the
 * two are provisioned together (see `docs/launch-checklist.md` §1).
 *
 * Fail-closed
 * -----------
 * When the secret key IS set, every failure mode is a rejection:
 * missing token, network error, non-200, malformed body, `success:
 * false`. There is no path where a configured gate lets a request
 * through unverified — otherwise an attacker would simply break the
 * verification call and walk in.
 *
 * Token single-use
 * ----------------
 * Turnstile tokens are single-use and expire in 5 minutes. That is why
 * the token travels in the action's Zod input shape rather than being
 * cached: a token consumed by one request cannot be replayed by the
 * next.
 */

/** Cloudflare's siteverify endpoint. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Deadline for the siteverify call. The verify happens inside a user-
 * facing server action, so a hung Cloudflare call would hang the form
 * submission. 5s is generous for a single POST that Cloudflare answers
 * in well under a second.
 */
const VERIFY_TIMEOUT_MS = 5000;

export type TurnstileVerifyResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * True when the CAPTCHA gate is switched on.
 *
 * The gate is on iff `TURNSTILE_SECRET_KEY` is set. Deliberately NOT
 * keyed on the site key: the site key is a public value that the
 * browser needs, the secret is what lets the server actually verify.
 * A deployment with only the site key would render a widget whose
 * tokens nobody can check — worse than no widget.
 */
export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/**
 * Verify a Turnstile token with Cloudflare.
 *
 * Returns `{ ok: true }` when the gate is OFF (no secret key) — the
 * caller then treats the request as if no CAPTCHA existed. When the
 * gate is ON, every failure is `{ ok: false }`.
 *
 * `remoteIp` is optional and sent only when the caller has it; it
 * strengthens Cloudflare's binding of the token to the request.
 */
export async function verifyTurnstileToken(args: {
  token: string | undefined | null;
  remoteIp?: string | null;
}): Promise<TurnstileVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // Gate off — nothing to verify, and no network call to make.
  if (!secret) return { ok: true };

  const token = args.token?.trim();
  if (!token) {
    return { ok: false, error: 'CAPTCHA verification is required.' };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (args.remoteIp) body.set('remoteip', args.remoteIp);

  let res: Response;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (e) {
    // Network failure or timeout. With the gate on, this is a
    // rejection — an unverifiable request is not a verified request.
    return {
      ok: false,
      error: `CAPTCHA verification could not be reached: ${(e as Error).message}`,
    };
  }

  if (!res.ok) {
    return { ok: false, error: `CAPTCHA verification returned HTTP ${res.status}.` };
  }

  let payload: { success?: boolean; 'error-codes'?: string[] };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    return { ok: false, error: 'CAPTCHA verification returned a malformed response.' };
  }

  if (payload.success !== true) {
    const codes = payload['error-codes'];
    return {
      ok: false,
      error: codes?.length
        ? `CAPTCHA verification failed: ${codes.join(', ')}.`
        : 'CAPTCHA verification failed.',
    };
  }

  return { ok: true };
}
