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

