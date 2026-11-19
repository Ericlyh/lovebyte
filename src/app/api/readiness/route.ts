import { NextResponse } from 'next/server';

/**
 * GET /api/readiness — which REQUIRED production env vars are missing.
 *
 * The readiness gate (`scripts/readiness-gate.mjs`) can only probe what
 * the deployed site tells it. The Stripe webhook route is such a probe:
 * a bogus signature comes back 400 when the keys are wired, 500 when
 * `STRIPE_WEBHOOK_SECRET` is absent, 503 when `STRIPE_SECRET_KEY` is
 * absent. The Resend side had no probe at all, so a deployment with no
 * `RESEND_API_KEY` looked perfectly healthy while every waitlist
 * autoresponder and every purchase receipt was a silent no-op
 * (OOP-6168).
 *
 * What this route reports:
 *   - the NAMES of missing required env vars — never their values, and
 *     never the value of a var that IS present.
 *   - the names are already public (`.env.example`,
 *     `docs/launch-checklist.md` §1), so this leaks nothing new; what
 *     it adds is the ability to tell "is the money path configured"
 *     from "the site renders".
 *   - `stripeKeyMode` — whether the deployed Stripe key can take REAL
 *     money. See below.
 *
 * `stripeKeyMode` exists because "the var is present" stopped being
 * the same claim as "the money path works" (OOP-6168). A deployment
 * carrying a TEST key (`sk_test_…`) has every required var present, so
 * `missing` is empty and the gate read the money path as READY — while
 * checkout could not take a single real payment, because a test key
 * never moves money. That is the same class of false green as the
 * 400-vs-503 webhook branch above: the probe reports "configured"
 * about a path that is not.
 *
 * It reports a MODE, never the key: the prefix is turned into
 * 'live' / 'test' / 'unknown' and the key itself is never echoed. That
 * is no more revealing than the var name, which is already public.
 *
 * `ok` deliberately stays "every required var is present" — it is an
 * ENV claim, not a money claim. Connect being enabled and a creator
 * being onboarded are account state this route cannot see, so widening
 * `ok` to mean "the money path is live" would overclaim. The gate
 * combines `missing` with `stripeKeyMode` instead.
 *
 * The list is a fixed allowlist on purpose: this endpoint must never
 * grow into a dump of the deployment's environment.
 *
 * `dynamic = 'force-dynamic'` matters. A statically prerendered route
 * would freeze the answer at BUILD time — and a build has none of these
 * vars — so every deployment would report all four missing forever.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vars without which the product cannot do its job. */
const REQUIRED_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM',
] as const;

/**
 * Which Stripe key is deployed, from its PREFIX only.
 *
 *   'live'    — a live-mode key; it can move real money
 *   'test'    — a test-mode key; charges are simulated, nothing is charged
 *   'unknown' — the key is absent, or its prefix is not one Stripe issues
 *
 * Restricted keys (`rk_…`) exist in both modes, so both prefixes are
 * recognised. The key value is never returned by this function.
 */
function stripeKeyMode(): 'live' | 'test' | 'unknown' {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return 'unknown';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

export async function GET() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);

  return NextResponse.json(
    { ok: missing.length === 0, missing, stripeKeyMode: stripeKeyMode() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
