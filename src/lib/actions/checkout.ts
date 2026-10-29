'use server';

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { stripe } from '@/lib/stripe';
import { sendShareEmail } from '@/lib/email';
import { trackEvent } from '@/lib/analytics/track';
import { resolveSessionId } from '@/lib/analytics/session';
import {
  PLATFORM_FEE_BPS_DEFAULT,
  SETTLEMENT_CURRENCY,
  SETTLEMENT_CURRENCY_DB,
  platformFeeCents,
} from '@/lib/money';

/**
 * Checkout + Connect onboarding server actions (M-E, OOP-4277).
 *
 * Three actions:
 *   - `startCheckoutSessionAction`: gates on the gift's `is_listed`,
 *     price > 0, AND the creator's `stripe_charges_enabled`. If any
 *     fails we return early — never create a Stripe Checkout Session
 *     for a purchase that can't settle.
 *   - `startFreeGiftAction`: the free-listing send path (OOP-6715).
 *     A gift with `price_cents IS NULL` has no money to move, so it
 *     never opens a Stripe session — it mints the share row directly
 *     and hands the buyer the link. See the long comment above it.
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

/**
 * The gift id shape.
 *
 * NOT `z.string().uuid()`. Zod enforces RFC 4122 — the version nibble
 * must be 1-5 and the variant nibble 8/9/a/b — but Postgres does not:
 * any 8-4-4-4-12 hex string is a valid `uuid` there. The seeded
 * catalogue uses `aaaa1111-0000-0000-0000-000000000001`-style ids,
 * which are valid Postgres uuids with a version nibble of 0, so Zod
 * rejected every one of them and the action answered "giftId must be
 * a UUID." for 8 of the 9 live listings.
 *
 * The `/api/gift-comments/[giftId]` route already validates ids this
 * way; this is the same rule, applied to the server action.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const checkoutInputSchema = z
  .object({
    giftId: z.string().regex(UUID_RE, 'giftId must be a UUID.'),
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
      'id, title, type, price_cents, currency, platform_fee_bps, owner_id, owner:profiles!owner_id(stripe_account_id, stripe_charges_enabled)',
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
    // Defence in depth. The checkout page routes free gifts to
    // `startFreeGiftAction`, so a live listing can no longer reach
    // this branch — it exists only for a stale client that calls the
    // paid action directly (OOP-6715).
    return { ok: false, error: 'This gift is free — no payment is needed.' };
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

  // OOP-6716 — the analytics session id. It rides along on the Stripe
  // metadata so the webhook can file the `purchase` under the SAME
  // session as this `checkout_start`: the webhook request carries no
  // browser cookie, so the session has to travel with the payment.
  const sessionId = await resolveSessionId();

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
          session_id: sessionId,
        },
      },
      // Also stamped on the session itself so the webhook can read it
      // without dereferencing payment_intent.
      metadata: {
        gift_id: gift.id,
        buyer_id: user.id,
        delivery_mode: deliveryMode,
        recipient_contact: recipient ?? '',
        session_id: sessionId,
      },
      success_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/checkout/cancel`,
      customer_email: user.email ?? undefined,
    });

    if (!session.url) {
      return { ok: false, error: 'Stripe did not return a checkout URL.' };
    }

    // OOP-6716 — the checkout step of the funnel. Recorded once the
    // session actually exists, so it counts real checkout attempts and
    // not clicks that died before Stripe.
    //
    // Awaited on purpose: a serverless function can be frozen the
    // moment the response is sent, so a fire-and-forget write here
    // would be lost exactly when it matters.
    await trackEvent(
      'checkout_start',
      {
        gift_id: gift.id,
        gift_type: gift.type,
        amount_cents: gift.price_cents,
        free: false,
        delivery_mode: deliveryMode,
      },
      { sessionId },
    );

    return { ok: true, url: session.url };
  } catch (e) {
    console.error('[checkout/start] stripe error', (e as Error).message);
    return { ok: false, error: 'Could not start checkout. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Free gifts (OOP-6715)
// ---------------------------------------------------------------------------

export type StartFreeGiftResult =
  | { ok: true; shareUrl: string; emailed: boolean }
  | { ok: false; error: string };

/**
 * `startFreeGiftAction` — send a free listing (OOP-6715).
 *
 * A listed gift with `price_cents IS NULL` has no money to move, so it
 * can never open a Stripe Checkout Session. The catalogue intent was
 * "free / contact creator" (`0002_marketplace_v2.sql`), but the contact
 * half was never built, so the listing CTA sent every free buyer into
 * a checkout that could only refuse them — after they had signed up and
 * typed a recipient email.
 *
 * This action is the send path the free listing was missing. It mints
 * the `shares` row itself and hands back the link, which is exactly
 * what the paid flow ends up with after the Stripe webhook fires:
 *
 *   paid  → buyer pays → webhook inserts shares(gift_id, created_by=buyer)
 *   free  → buyer clicks send → this action inserts the same row
 *
 * Two deliberate differences from the paid path:
 *
 *   1. No `purchases` row. `purchases.amount_cents` carries
 *      `check (amount_cents > 0)`, so a zero-amount purchase is not
 *      representable, and purchases are service-role-write only. The
 *      buyer's history lives in `/purchases` for paid gifts only; a
 *      free gift shows its link inline instead.
 *   2. The recipient email is best-effort. Resend is not configured in
 *      production yet (OOP-6168), so the email usually fails — but the
 *      share is already minted and the buyer gets the link on screen,
 *      so a failed email is a degraded delivery, not a failed send.
 *      We report which happened instead of swallowing it.
 *
 * RLS: `shares_insert_owner` checks only `auth.uid() = created_by`, so
 * the buyer may mint a share for a gift they did not create. That is
 * the same row the Stripe webhook writes for a paid purchase, where
 * `created_by` is the buyer too.
 */
export async function startFreeGiftAction(
  rawInput: unknown,
): Promise<StartFreeGiftResult> {
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

  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .select('id, title, type, price_cents')
    .eq('id', giftId)
    .eq('is_listed', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (giftErr) {
    console.error('[checkout/free] gift read failed', giftErr.message);
    return { ok: false, error: 'Could not load this listing right now.' };
  }
  if (!gift) {
    return { ok: false, error: 'This gift is no longer available.' };
  }
  if (gift.price_cents && gift.price_cents > 0) {
    // The buyer is on the paid form; this action only mints free
    // shares. Refusing here keeps a stale client from getting a free
    // link for a gift that should have been paid for.
    return {
      ok: false,
      error: 'This gift is not free — continue to payment instead.',
    };
  }

  // `shares.token` is the PK: 32 hex chars, the same shape the Stripe
  // webhook mints. The column default would do this too, but doing it
  // here saves a round trip and lets us return the link immediately.
  const shareToken = randomBytes(16).toString('hex');
  const { error: shareErr } = await supabase.from('shares').insert({
    token: shareToken,
    gift_id: gift.id,
    created_by: user.id,
  });

  if (shareErr) {
    console.error('[checkout/free] share insert failed', shareErr.message);
    return { ok: false, error: 'Could not create the share link. Try again.' };
  }

  // OOP-6716 — a free listing completes the funnel in ONE click: there
  // is no Stripe hop, so the share mint is both the start of the
  // checkout and its completion. Both steps are recorded (flagged
  // `free: true`) so the step-to-step ratios in the report stay
  // meaningful — otherwise the free half of the catalogue would show up
  // as a checkout_start with no matching purchase, and the funnel would
  // flatter the paid path.
  const sessionId = await resolveSessionId();
  await Promise.all([
    trackEvent(
      'checkout_start',
      {
        gift_id: gift.id,
        gift_type: gift.type,
        amount_cents: 0,
        free: true,
        delivery_mode: deliveryMode,
      },
      { sessionId },
    ),
    trackEvent(
      'purchase',
      {
        gift_id: gift.id,
        amount_cents: 0,
        currency: SETTLEMENT_CURRENCY.toUpperCase(),
        free: true,
      },
      { sessionId },
    ),
  ]);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  const shareUrl = `${siteUrl}/g/${shareToken}`;

  let emailed = false;
  const recipient = recipientContact?.trim();
  if (deliveryMode === 'send_to_recipient' && recipient) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, handle')
      .eq('id', user.id)
      .maybeSingle();
    const buyerName =
      profile?.display_name ?? (profile?.handle ? `@${profile.handle}` : null);

    const sent = await sendShareEmail({
      to: recipient,
      giftTitle: gift.title,
      shareToken,
      buyerName,
    });
    emailed = sent.ok;
    if (!sent.ok) {
      // Not fatal — the link is on screen for the buyer to copy.
      console.error('[checkout/free] share email failed', sent.error);
    }
  }

  return { ok: true, shareUrl, emailed };
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
