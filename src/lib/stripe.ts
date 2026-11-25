import 'server-only';
import Stripe from 'stripe';
import { BRAND } from './brand';

/**
 * Server-only Stripe SDK instance (M-E, OOP-4277).
 *
 * Lazy-initialised so `next build` doesn't crash when `STRIPE_SECRET_KEY`
 * isn't set in the build environment. The check fires on first use —
 * server actions, webhook, and connect-link — which all run on the Node
 * runtime at request time, not build time.
 *
 * `apiVersion` is pinned to a stable date so the SDK does not silently
 * drift to whatever the Stripe account's default is. Bump when
 * intentionally adopting a new API version; never leave undefined.
 */

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  if (!SECRET_KEY) {
    throw new Error('[stripe] STRIPE_SECRET_KEY is not set.');
  }
  _stripe = new Stripe(SECRET_KEY, {
    apiVersion: '2026-08-26.dahlia' as Stripe.LatestApiVersion,
    typescript: true,
    appInfo: {
      name: BRAND.NAME,
      version: '0.1.0',
    },
  });
  return _stripe;
}

/**
 * What Stripe is actually waiting for on a connected account (OOP-8359).
 *
 * `charges_enabled` is only half the answer. An account can be blocked
 * on `requirements.currently_due`, and each code says what the CREATOR
 * has to do — `external_account` means "add your bank account",
 * `tos_acceptance.*` means "accept Stripe's terms". The onboarding page
 * used to call that state "verification in progress", which described a
 * background process that does not exist.
 *
 * Returns `null` when Stripe cannot be reached, so the caller falls back
 * to copy that does not promise a background check.
 */
export type ConnectAccountState = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Stripe's requirement codes that are still outstanding. */
  currentlyDue: string[];
};

export async function readConnectAccountState(
  accountId: string | null | undefined,
): Promise<ConnectAccountState | null> {
  if (!accountId) return null;
  try {
    const account = await getStripe().accounts.retrieve(accountId);
    return {
      chargesEnabled: !!account.charges_enabled,
      payoutsEnabled: !!account.payouts_enabled,
      currentlyDue: account.requirements?.currently_due ?? [],
    };
  } catch (e) {
    console.error('[stripe] connect account read failed', (e as Error).message);
    return null;
  }
}

/**
 * Convenience proxy: `stripe.checkout.sessions.create(...)` etc.
 * Reads through the lazy getter so call sites don't change.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    const real = getStripe();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (real as any)[prop];
  },
});

