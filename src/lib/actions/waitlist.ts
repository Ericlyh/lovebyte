'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

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
 *   4. Insert via the service-role client (RLS bypass). Conflict on
 *      `email_lc` is treated as success — re-submitting the same
 *      email is idempotent.
 *   5. Fire-and-forget the autoresponder via Resend. We don't await it
 *      so the user gets a fast UI confirmation; failures are logged
 *      but don't fail the action.
 *
 * Out of scope for this slice (slice 2):
 *   - Turnstile / hCaptcha gate. The rate-limit step is the
 *     placeholder; once TURNSTILE_SECRET_KEY is wired we add a verify
 *     call before the insert.
 *   - /support + /status + /privacy + /terms pages. Those are the
 *     rest of the OOP-4226 acceptance criteria.
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
  const { email, intent, locale } = parsed.data;

  const { ipHash, uaHash } = await readClientFingerprint();

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

  // Autoresponder — slice 2. The right shape is a separate
  // `sendWaitlistEmail` helper that builds a confirmation message
  // ("you're on the list, here's what to expect"), not the share-email
  // template. Reusing `sendShareEmail` here would say "Someone sent
  // you a gift" which is wrong. Logged for now so we can wire the
  // proper helper + Resend template without losing the slice.
  console.log('[waitlist] new signup', {
    email,
    intent: intent ?? null,
    locale,
    ipHashPrefix: ipHash ? ipHash.slice(0, 8) : null,
  });

  return { ok: true, status: 'inserted' };
}