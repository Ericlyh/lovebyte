import { NextResponse } from 'next/server';
import { startConnectOnboardingAction } from '@/lib/actions/checkout';

/**
 * POST /api/stripe/connect-link — thin POST shim around
 * `startConnectOnboardingAction` (M-E, OOP-4277).
 *
 * Why a route when the server action already works? The
 * `ConnectPayoutsButton` client component calls the action via
 * `useTransition` and we want the same shape as the other action-driven
 * buttons. This route is reserved for the (future) case where Stripe
 * Connect needs to be initiated from a webhook or scheduled job — for
 * now, redirect callers to the server action directly.
 *
 * Status codes:
 *   200 { ok: true, url }      — onboarding URL minted
 *   401 { ok: false, error }   — not signed in
 *   500 { ok: false, error }   — Stripe SDK failure
 */
export const runtime = 'nodejs';

export async function POST() {
  const result = await startConnectOnboardingAction();
  if (result.ok) {
    return NextResponse.json({ ok: true, url: result.url });
  }
  const status = result.error === 'unauthenticated' ? 401 : 500;
  return NextResponse.json({ ok: false, error: result.error }, { status });
}
