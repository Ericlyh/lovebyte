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

export async function GET() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);

  return NextResponse.json(
    { ok: missing.length === 0, missing },
    { headers: { 'cache-control': 'no-store' } },
  );
}
