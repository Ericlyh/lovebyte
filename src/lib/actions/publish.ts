'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { startConnectOnboardingAction } from '@/lib/actions/checkout';
import { stripe } from '@/lib/stripe';
import { SETTLEMENT_CURRENCY_DB } from '@/lib/money';

/**
 * PublishToMarketplaceResult — returned by publishToMarketplaceAction.
 *
 * Three states:
 *   ok           — published successfully; client redirects to /l/[giftId].
 *   needsStripe  — paid gift but creator has no Stripe; client redirects to
 *                  onboarding URL. The listing intent has ALREADY been
 *                  persisted on the gift row, and the onboarding return URL
 *                  points back at the publish page (OOP-6720).
 *   error        — validation or server error; caller shows error message.
 */
export type PublishToMarketplaceResult =
  | { ok: true; giftId: string }
  | { ok: false; needsStripe: true; onboardingUrl: string }
  | { ok: false; needsStripe: false; error: string };

const publishInputSchema = z.object({
  giftId: z.string().uuid('giftId must be a UUID.'),
  title: z.string().trim().min(1, 'Title is required.').max(100, 'Title is too long.'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or fewer.')
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  coverMediaId: z.string().uuid().nullable().optional(),
  priceCents: z.number().int().min(0).nullable().optional(),
  platformFeeBps: z.number().int().min(500).max(10000).default(1000),
  /**
   * Set to true when re-calling after completing Stripe onboarding.
   *
   * This flag exists because the creator has ALREADY been through
   * onboarding — it must never bounce them through it a second time
   * (OOP-6720). It says "check Stripe's live state instead of the local
   * flag, and if Stripe is not ready yet, tell the creator to wait".
   */
  publishAfterStripe: z.boolean().optional().default(false),
});

/**
 * Ask Stripe whether the creator's connected account can take charges
 * RIGHT NOW.
 *
 * `profiles.stripe_charges_enabled` is written by the `account.updated`
 * webhook, and that webhook lands some seconds AFTER the creator
 * finishes onboarding. A creator who returns from Stripe and publishes
 * immediately reads the stale flag as "not enabled", gets bounced back
 * to onboarding, and loops forever — that was the paid-publish dead end
 * (OOP-6720). Stripe's API is the source of truth, so ask it directly
 * on the return leg.
 *
 * Fails closed: any error means "not enabled yet". Publishing a paid
 * listing whose creator cannot take payments is worse than asking them
 * to wait a few seconds.
 */
async function stripeAccountIsChargesEnabled(accountId: string | null): Promise<boolean> {
  if (!accountId) return false;
  try {
    const account = await stripe.accounts.retrieve(accountId);
    return !!account.charges_enabled;
  } catch (e) {
    console.error('[publish] stripe account check failed', (e as Error).message);
    return false;
  }
}

/**
 * Publish a gift to the marketplace (M-F, OOP-4278).
 *
 * Flow:
 *   1. Validate input.
 *   2. Load the gift.
 *   3. If price > 0 AND the creator has no charges-enabled Stripe
 *      account → persist the listing intent on the gift row, send the
 *      creator to Stripe onboarding with a return URL that completes the
 *      publish, and return needsStripe.
 *   4. Update gifts: is_listed=true, published_at=now(), status='published',
 *      plus the listing fields (title, description, cover_media_id,
 *      price_cents, currency, platform_fee_bps). `currency` is always the
 *      settlement currency (HKD) — it is not a creator's choice (OOP-6714).
 *   5. Return { ok: true, giftId } so the client can redirect.
 *
 * The paid round trip (OOP-6720):
 *
 *   publish(price > 0)          → intent persisted, returns needsStripe
 *   creator → Stripe onboarding → return_url = /create/<id>/finish?stripe=return
 *   return page re-calls publish(publishAfterStripe: true)
 *                                → Stripe says charges_enabled → published
 *
 * Before this, the return URL pointed at `/onboarding?stripe=return`,
 * which nothing read: the creator's title and price lived only in the
 * browser and were lost on the round-trip, and the listing never went
 * up. `publishAfterStripe` had no caller at all.
 *
 * Auth: requires authenticated user who owns the gift.
 */
export async function publishToMarketplaceAction(
  rawInput: unknown,
): Promise<PublishToMarketplaceResult> {
  const parsed = publishInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      needsStripe: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { giftId, title, description, coverMediaId, priceCents, platformFeeBps, publishAfterStripe } =
    parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, needsStripe: false, error: 'unauthenticated' };
  }

  // Load the draft gift. Must belong to the authenticated user.
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .select('id, owner_id, is_listed, price_cents, payload')
    .eq('id', giftId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (giftErr) {
    console.error('[publish] gift read failed', giftErr.message);
    return { ok: false, needsStripe: false, error: 'Could not load this gift right now.' };
  }
  if (!gift) {
    return { ok: false, needsStripe: false, error: 'Gift not found or you do not own it.' };
  }
  if (gift.is_listed) {
    return { ok: false, needsStripe: false, error: 'This gift is already listed.' };
  }

  // Empty-payload guard (OOP-5438). Every gift type now has a builder
  // (OOP-6720), so a user can only reach the publish card by first
  // filling one out. An empty payload here means a row that never went
  // through a builder — it must not list. Prebuilt seeded gifts are
  // inserted with full payloads by the seed script, so this guard does
  // not block them.
  const payload = (gift.payload ?? {}) as Record<string, unknown>;
  const payloadIsEmpty = Object.keys(payload).length === 0;
  if (payloadIsEmpty) {
    return {
      ok: false,
      needsStripe: false,
      error:
        'This gift has no content yet. Fill out the builder first, then publish.',
    };
  }

  // Determine effective price (null = free, 0 = free, >0 = paid).
  const effectivePriceCents = priceCents ?? null;
  const isPaidGift = effectivePriceCents !== null && effectivePriceCents > 0;

  // The listing fields, WITHOUT the "this is live" markers. They are
  // written twice: once onto the draft row when the creator is sent to
  // Stripe (so the listing survives the round-trip), and once with
  // is_listed + published_at when the publish actually lands.
  const listingFields = {
    title,
    description: description ?? null,
    cover_media_id: coverMediaId ?? null,
    price_cents: effectivePriceCents,
    // The marketplace settles in one currency (OOP-6714). A creator
    // does not pick one: every listing is priced in HKD, so the
    // catalogue, the filters and the platform fee all share a unit.
    currency: SETTLEMENT_CURRENCY_DB,
    platform_fee_bps: platformFeeBps,
  };

  // Stripe gating: a paid gift needs a connected account that can take
  // charges.
  if (isPaidGift) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_charges_enabled, stripe_account_id')
      .eq('id', user.id)
      .maybeSingle();

    let stripeEnabled = profile?.stripe_charges_enabled ?? false;

    // On the return leg the `account.updated` webhook may not have
    // landed yet, so ask Stripe for the live state instead of trusting
    // the local flag.
    if (!stripeEnabled && publishAfterStripe) {
      stripeEnabled = await stripeAccountIsChargesEnabled(
        (profile?.stripe_account_id as string | null) ?? null,
      );
    }

    if (!stripeEnabled) {
      if (publishAfterStripe) {
        // The creator has been through onboarding but Stripe is not
        // ready yet. Do NOT send them through onboarding a second time
        // — that is the loop that trapped every paid creator (OOP-6720).
        // The listing intent is already saved, so a retry publishes.
        return {
          ok: false,
          needsStripe: false,
          error:
            'Stripe is still finishing setting up your payouts. Give it a few seconds, then press Publish again.',
        };
      }

      // Persist the listing intent on the draft row BEFORE the creator
      // leaves for Stripe. The title, price and currency used to live
      // only in the creator's browser, and the round-trip threw them
      // away (OOP-6720) — they came back to a blank form.
      const { error: intentErr } = await supabase
        .from('gifts')
        .update(listingFields)
        .eq('id', giftId);
      if (intentErr) {
        console.error('[publish] listing intent persist failed', intentErr.message);
        return {
          ok: false,
          needsStripe: false,
          error: 'Could not save your listing details. Please try again.',
        };
      }

      // Send the creator to Stripe with a return URL that COMPLETES the
      // publish. The `stripe=return` param is what makes the publish
      // card re-run this action when they land back (OOP-6720).
      const onboardingResult = await startConnectOnboardingAction({
        returnPath: `/create/${giftId}/finish?stripe=return`,
        refreshPath: `/onboarding?stripe=refresh&gift=${giftId}`,
      });
      if (!onboardingResult.ok) {
        return {
          ok: false,
          needsStripe: false,
          error: 'Could not start Stripe onboarding. Please try again.',
        };
      }
      return { ok: false, needsStripe: true, onboardingUrl: onboardingResult.url };
    }
  }

  // Perform the publish update.
  const now = new Date().toISOString();
  const publishFields = {
    ...listingFields,
    is_listed: true,
    published_at: now,
  };

  const { error: updateErr } = await supabase
    .from('gifts')
    // A listed gift is a published gift (OOP-6717). `status` is what
    // tells a listed row apart from a draft the creator is still
    // working on.
    .update({ ...publishFields, status: 'published' })
    .eq('id', giftId);

  if (updateErr) {
    // `gifts_status_check` only allows draft/sent/archived until
    // migration 0013 is applied, and there is no DDL path from the
    // agent host — the change needs a human paste (OOP-6717). Publish
    // anyway rather than fail the creator's publish: the listing goes
    // up, and `status` catches up as soon as the migration lands.
    const statusNotMigrated =
      updateErr.code === '23514' && /status/.test(updateErr.message);
    if (!statusNotMigrated) {
      console.error('[publish] gift update failed', updateErr.message);
      return { ok: false, needsStripe: false, error: 'Could not publish this gift right now.' };
    }
    console.warn(
      '[publish] gifts.status = published rejected — migration 0013_gifts_status_published.sql is not applied yet',
    );
    const { error: retryErr } = await supabase
      .from('gifts')
      .update(publishFields)
      .eq('id', giftId);
    if (retryErr) {
      console.error('[publish] gift update failed', retryErr.message);
      return { ok: false, needsStripe: false, error: 'Could not publish this gift right now.' };
    }
  }

  return { ok: true, giftId };
}
