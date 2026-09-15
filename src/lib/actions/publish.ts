'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { startConnectOnboardingAction } from '@/lib/actions/checkout';

/**
 * PublishToMarketplaceResult — returned by publishToMarketplaceAction.
 *
 * Three states:
 *   ok           — published successfully; client redirects to /l/[giftId].
 *   needsStripe  — paid gift but creator has no Stripe; client redirects to
 *                  onboarding URL. On return, the client re-calls with
 *                  publishAfterStripe = true.
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
  currency: z.enum(['usd', 'hkd', 'gbp', 'eur', 'jpy', 'cad', 'aud']).default('usd'),
  platformFeeBps: z.number().int().min(500).max(10000).default(1000),
  /** Set to true when re-calling after completing Stripe onboarding. */
  publishAfterStripe: z.boolean().optional().default(false),
});

/**
 * Publish a gift to the marketplace (M-F, OOP-4278).
 *
 * Flow:
 *   1. Validate input.
 *   2. Load the gift + creator's stripe_charges_enabled.
 *   3. If price > 0 AND creator not Stripe-enabled → return needsStripe;
 *      client redirects to onboarding, then re-calls with publishAfterStripe.
 *   4. Update gifts: is_listed=true, published_at=now(), plus the listing
 *      fields (title, description, cover_media_id, price_cents, currency,
 *      platform_fee_bps).
 *   5. Return { ok: true, giftId } so the client can redirect.
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
  const { giftId, title, description, coverMediaId, priceCents, currency, platformFeeBps, publishAfterStripe } =
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
    .select('id, owner_id, is_listed, price_cents')
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

  // Determine effective price (null = free, 0 = free, >0 = paid).
  const effectivePriceCents = priceCents ?? null;
  const isPaidGift = effectivePriceCents !== null && effectivePriceCents > 0;

  // Stripe gating: if paid gift and creator not Stripe-enabled, redirect to onboarding.
  if (isPaidGift && !publishAfterStripe) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_charges_enabled')
      .eq('id', user.id)
      .maybeSingle();

    const stripeEnabled = profile?.stripe_charges_enabled ?? false;
    if (!stripeEnabled) {
      // Call the M-E onboarding action to get the onboarding URL.
      const onboardingResult = await startConnectOnboardingAction();
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
  const { error: updateErr } = await supabase
    .from('gifts')
    .update({
      is_listed: true,
      published_at: now,
      title,
      description: description ?? null,
      cover_media_id: coverMediaId ?? null,
      price_cents: effectivePriceCents,
      currency,
      platform_fee_bps: platformFeeBps,
    })
    .eq('id', giftId);

  if (updateErr) {
    console.error('[publish] gift update failed', updateErr.message);
    return { ok: false, needsStripe: false, error: 'Could not publish this gift right now.' };
  }

  return { ok: true, giftId };
}
