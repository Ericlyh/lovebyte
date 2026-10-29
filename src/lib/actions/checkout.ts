'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import {
  PLATFORM_FEE_BPS_DEFAULT,
  SETTLEMENT_CURRENCY,
  SETTLEMENT_CURRENCY_DB,
  platformFeeCents,
} from '@/lib/money';

/**
 * Checkout + Connect onboarding server actions (M-E, OOP-4277).
 *
 * Two actions:
 *   - `startCheckoutSessionAction`: gates on the gift's `is_listed`,
 *     price > 0, AND the creator's `stripe_charges_enabled`. If any
 *     fails we return early — never create a Stripe Checkout Session
 *     for a purchase that can't settle.
 *   - `startConnectOnboardingAction`: creates (or reuses) the creator's
 *     Stripe Express account + AccountLink and returns the hosted URL.
 *     The account id is persisted to `profiles.stripe_account_id`
 *     immediately so subsequent calls dedupe to the same account.
 *
 * Money math (OOP-6714):
 *   The marketplace settles in ONE currency — HKD. `price_cents` is HKD
 *   cents and the Stripe `price_data.currency` is the settlement
 *   currency; there is no FX conversion at checkout and no per-listing
 *   currency to read from the row.
 *
 *   application_fee_amount = floor(amount_cents * platform_fee_bps / 10000)
 *   `gifts.platform_fee_bps` is in basis points (500–10000). Default
 *   1000 = 10%. The fee is computed on the settlement amount and
 *   rounded DOWN to the nearest cent, so the creator keeps the
 *   remainder — see `platformFeeCents` in `src/lib/money.ts`, which is
 *   the single definition of that rule and is shared with the Stripe
 *   webhook.
 *
 * Webhook ownership: the success-side effects (purchase row, share
 * token, recipient email) live in `/api/stripe/webhook`, NOT here. The
 * server action only creates the Checkout Session; the source of truth
 * for "did this pay" is the Stripe webhook.
 */

const checkoutInputSchema = z
  .object({
    giftId: z.string().uuid('giftId must be a UUID.'),
    deliveryMode: z.enum(['send_to_recipient', 'buyer_shares']),
    recipientContact: z
      .string()
      .trim()
      .min(1, 'Recipient email is required.')
      .max(254, 'Email is too long.')
      .optional()
      .or(z.literal('')),
  })
  .refine(
    (v) =>
      v.deliveryMode !== 'send_to_recipient' ||
      (typeof v.recipientContact === 'string' &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.recipientContact)),
    {
      message: 'Please enter a valid recipient email.',
      path: ['recipientContact'],
    },
  );

export type StartCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function startCheckoutSessionAction(
  rawInput: unknown,
): Promise<StartCheckoutResult> {
  const parsed = checkoutInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { giftId, deliveryMode, recipientContact } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // Load the gift + the creator's Stripe state in one round trip.
  // The join goes through the FK `gifts.owner_id → profiles.id` so the
  // caller's RLS on `profiles` lets them see the creator's stripe
  // columns (they only need the boolean + id, not the secret key).
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .select(
      'id, title, price_cents, currency, platform_fee_bps, owner_id, owner:profiles!owner_id(stripe_account_id, stripe_charges_enabled)',
    )
    .eq('id', giftId)
    .eq('is_listed', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (giftErr) {
    console.error('[checkout/start] gift read failed', giftErr.message);
    return { ok: false, error: 'Could not load this listing right now.' };
  }
  if (!gift) {
    return { ok: false, error: 'This gift is no longer available.' };
  }
  if (!gift.price_cents || gift.price_cents <= 0) {
    return { ok: false, error: 'This gift is free — no checkout needed.' };
  }
  // The price is charged in the settlement currency (HKD). A row that
  // still carries another currency has a `price_cents` in the wrong
  // unit, so refuse rather than charge an amount that means something
  // else (OOP-6714).
  if ((gift.currency ?? '').trim().toUpperCase() !== SETTLEMENT_CURRENCY_DB) {
    console.error(
      `[checkout/start] gift ${gift.id} is not in the settlement currency (${gift.currency})`,
    );
    return {
      ok: false,
      error: 'This listing is not available for purchase right now.',
    };
  }

  const owner = Array.isArray(gift.owner) ? gift.owner[0] : gift.owner;
  if (!owner?.stripe_account_id || !owner.stripe_charges_enabled) {
    return {
      ok: false,
      error: 'This creator is not set up to receive payouts yet.',
    };
  }

  const feeCents = platformFeeCents(
    gift.price_cents,
    gift.platform_fee_bps ?? PLATFORM_FEE_BPS_DEFAULT,
  );
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const recipient = recipientContact?.trim() || undefined;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            // The settlement currency. `price_cents` is already HKD
            // cents — there is no per-listing currency and no FX step
            // here (OOP-6714).
            currency: SETTLEMENT_CURRENCY,
            product_data: { name: gift.title },
            unit_amount: gift.price_cents,
          },
          quantity: 1,
        },
      ],
      // Destination charge: money goes to the creator's connected
      // account; Lovorithm skims the platform fee.
      payment_intent_data: {
        application_fee_amount: feeCents,
        transfer_data: { destination: owner.stripe_account_id },
        metadata: {
          gift_id: gift.id,
          buyer_id: user.id,
          delivery_mode: deliveryMode,
          recipient_contact: recipient ?? '',
        },
      },
      // Also stamped on the session itself so the webhook can read it
      // without dereferencing payment_intent.
      metadata: {
        gift_id: gift.id,
        buyer_id: user.id,
        delivery_mode: deliveryMode,
        recipient_contact: recipient ?? '',
      },
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
      customer_email: user.email ?? undefined,
    });

    if (!session.url) {
      return { ok: false, error: 'Stripe did not return a checkout URL.' };
    }
    return { ok: true, url: session.url };
  } catch (e) {
    console.error('[checkout/start] stripe error', (e as Error).message);
    return { ok: false, error: 'Could not start checkout. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Connect onboarding
// ---------------------------------------------------------------------------

export type StartConnectOnboardingResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const ONBOARDING_REFRESH_URL_ENV = 'NEXT_PUBLIC_SITE_URL';

function onboardingBaseUrl(): string {
  return process.env[ONBOARDING_REFRESH_URL_ENV] ?? 'http://localhost:3000';
}

export async function startConnectOnboardingAction(): Promise<StartConnectOnboardingResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // Look up any existing Connect account id so re-clicks don't create a
  // new Express account on Stripe's side. The onboarding link itself
  // can be regenerated cheaply.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    console.error('[checkout/connect] profile read failed', profileErr.message);
    return { ok: false, error: 'Could not start onboarding right now.' };
  }

  let accountId = profile?.stripe_account_id ?? null;
  try {
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        controller: {
          fees: { payer: 'application' },
          losses: { payments: 'application' },
          requirement_collection: 'stripe',
        },
        email: user.email ?? undefined,
        metadata: { profile_id: user.id },
      });
      accountId = account.id;

      const { error: writeErr } = await supabase
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);
      if (writeErr) {
        console.error('[checkout/connect] persist account id failed', writeErr.message);
        // Non-fatal — onboarding can continue; the user can refresh.
      }
    }

    const base = onboardingBaseUrl().replace(/\/$/, '');
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${base}/onboarding?stripe=refresh`,
      return_url: `${base}/onboarding?stripe=return`,
      type: 'account_onboarding',
    });

    return { ok: true, url: link.url };
  } catch (e) {
    console.error('[checkout/connect] stripe error', (e as Error).message);
    return { ok: false, error: 'Could not start Stripe onboarding. Please try again.' };
  }
}
