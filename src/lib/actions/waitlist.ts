'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { z } from 'zod';
import { sendWaitlistEmail } from '@/lib/email';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { trackEvent } from '@/lib/analytics/track';
import { turnstileEnabled, verifyTurnstileToken } from '@/lib/turnstile';

/**
 * Waitlist server action (Phase 10, OOP-4226 — beta launch prep).
 *
 * Captures a pre-account email from the landing-page form. The
 * `public.waitlist` table (migration 0008) has no anon-INSERT policy,
 * so this action is the only insert path. The flow:
 *
 *   1. Validate + sanitise the input (Zod; rejects bad shapes early).
 *   2. Hash the requester IP + UA so the table carries no raw PII.
 *   3. Rate-limit: reject if the same IP-hash or UA-hash submitted in
 *      the last hour. Constant in this slice (slice 2 will move the
 *      threshold into env / KV if the volume warrants it).
 *   4. Turnstile gate (OOP-6161). Dormant until `TURNSTILE_SECRET_KEY`
 *      is set — with the gate off this step is a no-op; with it on, a
 *      missing or invalid token rejects the submission BEFORE the
 *      insert, so an unverified request never reaches the table.
 *   5. Insert via the service-role client (RLS bypass). Conflict on
 *      `email_lc` is treated as success — re-submitting the same
 *      email is idempotent.
 *   6. Send the autoresponder via Resend (OOP-6156). We await the
 *      call so the serverless function is not frozen mid-request
 *      before the HTTP round-trip completes; a failed send is logged
 *      but does not fail the action, because the DB row is the source
 *      of truth and the requester is already on the list.
 *
 * Why a server action and not `/api/waitlist`? Mirrors the
 * `createCommentAction` / `joinWaitlistAction` pattern — the form is
 * a Server Component so a server action gives us the same auth /
 * cookie flow as the rest of the app without a separate REST route.
 */

const joinSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email.'),
  intent: z
    .string()
    .trim()
    .max(64, 'intent is too long (64 chars max).')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  locale: z.enum(['en', 'zh-Hant']).default('en'),
  /**
   * The Turnstile token, when the gate is on. Optional in the schema
   * because the gate is OFF by default (no `TURNSTILE_SECRET_KEY`), and
   * in that mode the token must not be required. When the gate IS on,
   * `verifyTurnstileToken` rejects a missing token — the schema stays
   * permissive so one shape serves both modes.
   */
  turnstileToken: z.string().trim().max(2048).optional(),
});

export type JoinWaitlistInput = z.input<typeof joinSchema>;

export type JoinWaitlistResult =
  | { ok: true; status: 'inserted' | 'already_on_list' }
  | { ok: false; error: string };

const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour per IP/UA

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function readClientFingerprint(): Promise<{
  ipHash: string | null;
  uaHash: string | null;
  /** The raw client IP, for Turnstile's `remoteip` binding. Never stored. */
  ip: string | null;
}> {
  // Headers in Next.js are read-only and proxied; only forward-headers
  // set by the Vercel proxy populate x-forwarded-for. We tolerate
  // missing values (localhost dev / curl probes) and just hash what we
  // can — rate-limit falls back to UA-hash alone in that case.
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() ?? null;
  const ua = h.get('user-agent')?.trim() ?? null;
  return {
    ipHash: ip ? sha256(ip) : null,
    uaHash: ua ? sha256(ua) : null,
    ip,
  };
}

export async function joinWaitlistAction(
  input: JoinWaitlistInput,
): Promise<JoinWaitlistResult> {
  const parsed = joinSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Invalid input.' };
  }
  const { email, intent, locale, turnstileToken } = parsed.data;

  const { ipHash, uaHash, ip } = await readClientFingerprint();

  const sb = await createServiceRoleClient();

  // Rate-limit check — one submission per (ip_hash OR ua_hash) per hour.
  // We check both so dev/curl (no ip) and behind-proxy (no ua) still gate.
  const cutoff = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
  if (ipHash || uaHash) {
    const orClauses: string[] = [];
    if (ipHash) orClauses.push(`ip_hash.eq.${ipHash}`);
    if (uaHash) orClauses.push(`ua_hash.eq.${uaHash}`);
    const { data: recent, error: rateErr } = await sb
      .from('waitlist')
      .select('id', { count: 'exact', head: true })
      .or(orClauses.join(','))
      .gte('created_at', cutoff);
    if (rateErr) {
      // Surface as an error — the table read shouldn't fail under
      // normal operation, and silently passing would bypass the gate.
      return { ok: false, error: `Rate-limit check failed: ${rateErr.message}` };
    }
    if (recent && recent.length > 0) {
      return {
        ok: false,
        error: 'You already joined the waitlist in the last hour. Try again later.',
      };
    }
  }

  // Turnstile gate (OOP-6161). Dormant until `TURNSTILE_SECRET_KEY` is
  // set — `verifyTurnstileToken` short-circuits to ok without a network
  // call in that case. With the gate on, this runs BEFORE the insert so
  // an unverified request never reaches the table, and it fails CLOSED:
  // a missing token, a network error, or `success: false` all reject.
  //
  // Ordering note: the rate-limit is checked BEFORE this, not after.
  // Both must pass before the insert either way, but the rate-limit is
  // a cheap DB read while this is an outbound HTTPS call to Cloudflare
  // — so checking it first keeps a flood of rejected submissions from
  // spending a Cloudflare round-trip each. It also means a rate-limited
  // request never burns the user's single-use CAPTCHA token, so they
  // are not left staring at a solved widget that no longer verifies.
  if (turnstileEnabled()) {
    const verdict = await verifyTurnstileToken({ token: turnstileToken, remoteIp: ip });
    if (!verdict.ok) {
      console.warn('[waitlist] turnstile rejected a submission', {
        error: verdict.error,
      });
      return { ok: false, error: verdict.error };
    }
  }

  // Insert. On `email_lc` conflict (case-insensitive unique), we treat
  // it as success — re-submission is idempotent. Cast through unknown
  // to the row shape — the service-role client doesn't have generated
  // DB types yet (see `src/lib/supabase/server.ts` comment), so we
  // assert the row shape inline. When the generated types land this
  // cast becomes a no-op. (Same pattern as the stripe webhook dedup
  // insert in `src/app/api/stripe/webhook/route.ts`.)
  const waitlistRow = {
    email,
    intent: intent ?? null,
    locale,
    source: 'landing',
    ip_hash: ipHash,
    ua_hash: uaHash,
  };
  const { error: insertErr } = await (
    sb.from('waitlist') as unknown as {
      insert: (row: typeof waitlistRow) => Promise<{ error: { code?: string; message: string } | null }>;
    }
  ).insert(waitlistRow);
  if (insertErr) {
    // 23505 = unique_violation — PostgREST surfaces this as the
    // `code` field on the error. Other errors are surfaced verbatim.
    const code = (insertErr as { code?: string }).code;
    if (code === '23505') {
      return { ok: true, status: 'already_on_list' };
    }
    return { ok: false, error: insertErr.message };
  }

  // OOP-6716 — the signup is recorded as an analytics event, which
  // replaces the bare console.log that used to sit here.
  //
  // The event carries NO email address and NO intent: both are
  // free-text the requester typed, and the row in `public.waitlist` is
  // already the record of who signed up. The event only says that
  // someone did — which is the only thing the funnel needs.
  await trackEvent('waitlist_signup', { locale, source: 'landing' });

  // Autoresponder — OOP-6156. Awaited (rather than fire-and-forget)
  // so the serverless function is not frozen mid-request before the
  // HTTP round-trip to Resend completes. A failed send is logged but
  // does NOT fail the action: the DB row is the source of truth and
  // the requester is already on the list, so failing here would only
  // make the form look broken for a signup that actually succeeded.
  const mail = await sendWaitlistEmail({ to: email, locale });
  if (!mail.ok) {
    console.error('[waitlist] autoresponder failed', mail.error);
  }

  return { ok: true, status: 'inserted' };
}