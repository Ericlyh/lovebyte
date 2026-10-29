import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publishToMarketplaceAction } from './publish';
import { SETTLEMENT_CURRENCY_DB } from '@/lib/money';

/**
 * The paid-publish round trip (OOP-6720).
 *
 * The bug: a creator who set a price was sent to Stripe onboarding and
 * the publish was abandoned. Stripe's return URL pointed at
 * `/onboarding?stripe=return`, which nothing read — the creator's title
 * and price lived only in the browser and were lost on the round-trip,
 * so the listing never went up. The `publishAfterStripe` escape hatch
 * had no caller at all: `grep -rn "publishAfterStripe" src` returned
 * only the schema field, the destructure and the check.
 *
 * These tests pin the round trip that replaces it:
 *
 *   1. publish(price > 0)  → the listing intent is persisted on the
 *                             gift row, the creator is sent to Stripe,
 *                             and Stripe's return URL points at the
 *                             publish page with `?stripe=return`.
 *   2. the creator completes onboarding.
 *   3. publish(publishAfterStripe: true) → the listing goes live.
 *
 * Plus the two ways step 3 can legitimately fail: Stripe is not ready
 * yet (say so, do NOT bounce them through onboarding again) and the
 * gift is free (never touch Stripe at all).
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const GIFT_ID = '22222222-2222-4222-8222-222222222222';

const { state, fakeFrom } = vi.hoisted(() => {
  const state = {
    /** The signed-in creator. `null` = signed out. */
    user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
    /** The gift row the read resolves to. */
    gift: null as Record<string, unknown> | null,
    /** The creator's profile row. */
    profile: null as Record<string, unknown> | null,
    /** Every row written to `gifts`. */
    giftUpdates: [] as Record<string, unknown>[],
    /** Every row written to `profiles`. */
    profileUpdates: [] as Record<string, unknown>[],
    /** Error returned by the next `update()`. */
    updateError: null as { message: string; code?: string } | null,
    /** Whether Stripe currently says the connected account can charge. */
    stripeChargesEnabled: false,
    /** How many times Stripe's account was read. */
    stripeRetrieveCount: 0,
    /** How many onboarding links were created. */
    accountLinkCount: 0,
    /** The parameters of the last onboarding link. */
    accountLink: null as {
      account: string;
      refresh_url: string;
      return_url: string;
    } | null,
  };

  /**
   * A minimal stand-in for the cookie-bound Supabase client.
   *
   * The publish action and the onboarding action only ever call
   * `select().eq().eq().maybeSingle()` / `select().eq().maybeSingle()`,
   * `update().eq()` and `insert()` — so that is all this fakes. The
   * builder is thenable, because `await supabase.from(x).update(row).eq(k, v)`
   * is how the real client resolves a write.
   */
  const fakeFrom = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = async () => {
      if (table === 'gifts') return { data: state.gift, error: null };
      if (table === 'profiles') return { data: state.profile, error: null };
      return { data: null, error: null };
    };
    builder.insert = async () => ({ data: null, error: null });
    builder.update = (row: Record<string, unknown>) => {
      if (table === 'gifts') state.giftUpdates.push(row);
      else if (table === 'profiles') state.profileUpdates.push(row);
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: null, error: state.updateError }).then(resolve);
    return builder;
  };

  return { state, fakeFrom };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => fakeFrom(table),
  }),
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    accounts: {
      create: async () => ({ id: 'acct_test' }),
      retrieve: async (id: string) => {
        state.stripeRetrieveCount += 1;
        return { id, charges_enabled: state.stripeChargesEnabled };
      },
    },
    accountLinks: {
      create: async (params: {
        account: string;
        refresh_url: string;
        return_url: string;
      }) => {
        state.accountLinkCount += 1;
        state.accountLink = params;
        return { url: 'https://connect.stripe.test/setup/test-session' };
      },
    },
  },
}));

/** The gift as the publish action reads it: a built, unlisted draft. */
function builtGift(overrides: Record<string, unknown> = {}) {
  return {
    id: GIFT_ID,
    owner_id: USER_ID,
    is_listed: false,
    price_cents: null,
    payload: { markdown: 'Dear you,\n\nHello.' },
    ...overrides,
  };
}

beforeEach(() => {
  state.user = { id: USER_ID };
  state.gift = builtGift();
  state.profile = {
    stripe_charges_enabled: false,
    stripe_account_id: 'acct_test',
  };
  state.giftUpdates = [];
  state.profileUpdates = [];
  state.updateError = null;
  state.stripeChargesEnabled = false;
  state.stripeRetrieveCount = 0;
  state.accountLinkCount = 0;
  state.accountLink = null;
});

describe('publishToMarketplaceAction — the paid round trip', () => {
  it('publishes → Stripe → return → published', async () => {
    // ── Leg 1: the creator sets a price and presses publish ──────────
    const first = await publishToMarketplaceAction({
      giftId: GIFT_ID,
      title: 'A letter for you',
      description: 'Open it on a quiet evening.',
      coverMediaId: null,
      priceCents: 5000,
    });

    expect(first.ok).toBe(false);
    expect(first.ok === false && first.needsStripe).toBe(true);
    expect(
      first.ok === false && first.needsStripe === true && first.onboardingUrl,
    ).toBeTruthy();

    // The listing intent was persisted on the gift row BEFORE the
    // creator left for Stripe. This is what used to be lost.
    expect(state.giftUpdates).toHaveLength(1);
    const intent = state.giftUpdates[0];
    expect(intent.title).toBe('A letter for you');
    expect(intent.description).toBe('Open it on a quiet evening.');
    expect(intent.price_cents).toBe(5000);
    expect(intent.currency).toBe(SETTLEMENT_CURRENCY_DB);
    // …and it is NOT live yet.
    expect(intent.is_listed).toBeUndefined();
    expect(intent.published_at).toBeUndefined();
    expect(intent.status).toBeUndefined();

    // Stripe's return URL comes back to the page that completes the
    // publish. This is the line that used to point at a page that
    // could not complete it.
    expect(state.accountLinkCount).toBe(1);
    expect(state.accountLink?.return_url).toMatch(
      new RegExp(`/create/${GIFT_ID}/finish\\?stripe=return$`),
    );

    // ── The creator completes onboarding ─────────────────────────────
    // Stripe says the account can now take charges. The local
    // `stripe_charges_enabled` flag is still false — the
    // `account.updated` webhook has not landed yet.
    state.stripeChargesEnabled = true;

    // ── Leg 2: the return page re-runs the publish ───────────────────
    const second = await publishToMarketplaceAction({
      giftId: GIFT_ID,
      title: 'A letter for you',
      description: 'Open it on a quiet evening.',
      coverMediaId: null,
      priceCents: 5000,
      publishAfterStripe: true,
    });

    expect(second).toEqual({ ok: true, giftId: GIFT_ID });

    // The listing is live.
    const published = state.giftUpdates[state.giftUpdates.length - 1];
    expect(published.is_listed).toBe(true);
    expect(published.status).toBe('published');
    expect(published.published_at).toBeTruthy();
    expect(published.price_cents).toBe(5000);
    expect(published.currency).toBe(SETTLEMENT_CURRENCY_DB);

    // And the creator was never sent through onboarding a second time.
    expect(state.accountLinkCount).toBe(1);
  });

  it('does not bounce the creator back to onboarding when Stripe is not ready yet', async () => {
    state.stripeChargesEnabled = false;

    const result = await publishToMarketplaceAction({
      giftId: GIFT_ID,
      title: 'A letter for you',
      priceCents: 5000,
      publishAfterStripe: true,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.needsStripe).toBe(false);
    expect(result.ok === false && !result.needsStripe && result.error).toMatch(
      /Stripe is still finishing/,
    );

    // No second onboarding link, and nothing was published.
    expect(state.accountLinkCount).toBe(0);
    expect(state.stripeRetrieveCount).toBe(1);
    const last = state.giftUpdates[state.giftUpdates.length - 1];
    expect(last?.is_listed).toBeUndefined();
  });

  it('trusts the local flag when the webhook has already landed', async () => {
    state.profile = {
      stripe_charges_enabled: true,
      stripe_account_id: 'acct_test',
    };

    const result = await publishToMarketplaceAction({
      giftId: GIFT_ID,
      title: 'A letter for you',
      priceCents: 5000,
      publishAfterStripe: true,
    });

    expect(result).toEqual({ ok: true, giftId: GIFT_ID });
    // No need to ask Stripe when the flag already says yes.
    expect(state.stripeRetrieveCount).toBe(0);
  });

  it('publishes a free gift without touching Stripe', async () => {
    const result = await publishToMarketplaceAction({
      giftId: GIFT_ID,
      title: 'A letter for you',
      priceCents: null,
    });

    expect(result).toEqual({ ok: true, giftId: GIFT_ID });
    expect(state.accountLinkCount).toBe(0);
    expect(state.stripeRetrieveCount).toBe(0);
  });

  it('refuses to publish a gift with no content', async () => {
    state.gift = builtGift({ payload: {} });

    const result = await publishToMarketplaceAction({
      giftId: GIFT_ID,
      title: 'A letter for you',
      priceCents: 5000,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && !result.needsStripe && result.error).toMatch(
      /no content yet/,
    );
    expect(state.giftUpdates).toHaveLength(0);
  });
});
