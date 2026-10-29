import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  startCheckoutSessionAction,
  startFreeGiftAction,
} from './checkout';

/**
 * Regression tests for the free-listing send path (OOP-6715).
 *
 * The bug: a listed gift with `price_cents IS NULL` — "Free" — sent
 * every buyer into the paid checkout, where it could only refuse them
 * ("This gift is free — no checkout needed."). The refusal landed
 * after the buyer had signed up and typed a recipient email. Half the
 * catalogue (5 of 9 listings) was priced Free, so half the catalogue
 * dead-ended.
 *
 * The fix: `startFreeGiftAction` mints the `shares` row the Stripe
 * webhook would have minted for a paid purchase and hands the buyer
 * the link. These tests pin the behaviour that matters:
 *
 *   - a free listing mints a share and returns a usable link
 *   - the share is attributed to the BUYER, exactly like the webhook
 *   - a paid listing is refused by the free action (no free ride)
 *   - an unauthenticated caller is refused
 *   - a failed recipient email does NOT lose the share
 *   - the paid action never opens a Stripe session for a free gift
 */

const { state, fakeFrom } = vi.hoisted(() => {
  const state = {
    /** The signed-in buyer. `null` = signed out. */
    user: { id: '11111111-1111-1111-1111-111111111111' } as { id: string } | null,
    /** The listing row the gift read resolves to. */
    gift: null as Record<string, unknown> | null,
    giftError: null as { message: string } | null,
    /** Every row inserted into `shares`. */
    insertedShares: [] as Record<string, unknown>[],
    shareInsertError: null as { message: string } | null,
    /** The buyer's own profile row. */
    profile: null as Record<string, unknown> | null,
    /** Every `sendShareEmail` call. */
    emails: [] as {
      to: string;
      giftTitle: string;
      shareToken: string;
      buyerName: string | null;
    }[],
    emailResult: { ok: true, id: 'stub-1' } as {
      ok: boolean;
      id?: string;
      error?: string;
    },
    /** How many Stripe Checkout Sessions were created. */
    stripeSessionsCreated: 0,
  };

  /**
   * A minimal stand-in for the cookie-bound Supabase client. The
   * action only ever calls `select().eq().eq().is().maybeSingle()` on
   * `gifts`, `select().eq().maybeSingle()` on `profiles`, and
   * `insert()` on `shares` — so that is all this fakes.
   */
  const fakeFrom = (table: string) => ({
    select: () => {
      const builder: Record<string, unknown> = {};
      builder.eq = () => builder;
      builder.is = () => builder;
      builder.maybeSingle = async () => {
        if (table === 'gifts') return { data: state.gift, error: state.giftError };
        if (table === 'profiles') return { data: state.profile, error: null };
        return { data: null, error: null };
      };
      return builder;
    },
    insert: async (row: Record<string, unknown>) => {
      state.insertedShares.push(row);
      return { error: state.shareInsertError };
    },
  });

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

vi.mock('@/lib/email', () => ({
  sendShareEmail: async (args: {
    to: string;
    giftTitle: string;
    shareToken: string;
    buyerName: string | null;
  }) => {
    state.emails.push(args);
    return state.emailResult;
  },
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: {
      sessions: {
        create: async () => {
          state.stripeSessionsCreated += 1;
          return { id: 'cs_test', url: 'https://checkout.stripe.test/session' };
        },
      },
    },
  },
}));

const FREE_GIFT = {
  id: 'aaaa2222-0000-0000-0000-000000000001',
  title: 'Bangkok street photo puzzle',
  price_cents: null,
  currency: 'HKD',
  platform_fee_bps: 1000,
  owner_id: '22222222-2222-2222-2222-222222222222',
  owner: { stripe_account_id: 'acct_123', stripe_charges_enabled: true },
};

const PAID_GIFT = {
  ...FREE_GIFT,
  id: 'aaaa3333-0000-0000-0000-000000000002',
  title: 'Trivia of our first year',
  price_cents: 1800,
};

const BUYER_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  state.user = { id: BUYER_ID };
  state.gift = { ...FREE_GIFT };
  state.giftError = null;
  state.insertedShares = [];
  state.shareInsertError = null;
  state.profile = { display_name: 'Ada Lovelace', handle: 'ada' };
  state.emails = [];
  state.emailResult = { ok: true, id: 'stub-1' };
  state.stripeSessionsCreated = 0;
});

describe('startFreeGiftAction (OOP-6715)', () => {
  it('mints a share row for a free listing and returns the link', async () => {
    const result = await startFreeGiftAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(state.insertedShares).toHaveLength(1);
    const row = state.insertedShares[0];
    expect(row.gift_id).toBe(FREE_GIFT.id);
    // The buyer owns the share, exactly like the Stripe webhook's row —
    // this is what `shares_insert_owner` (auth.uid() = created_by)
    // allows, and what makes the RLS insert pass.
    expect(row.created_by).toBe(BUYER_ID);
    expect(row.token).toMatch(/^[0-9a-f]{32}$/);

    expect(result.shareUrl.endsWith(`/g/${row.token}`)).toBe(true);
  });

  it('refuses a paid listing — a free action must not be a free ride', async () => {
    state.gift = { ...PAID_GIFT };

    const result = await startFreeGiftAction({
      giftId: PAID_GIFT.id,
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(false);
    expect(state.insertedShares).toHaveLength(0);
  });

  it('refuses an unauthenticated caller', async () => {
    state.user = null;

    const result = await startFreeGiftAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
    expect(state.insertedShares).toHaveLength(0);
  });

  it('rejects a missing recipient email before touching the database', async () => {
    const result = await startFreeGiftAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'send_to_recipient',
      recipientContact: 'not-an-email',
    });

    expect(result.ok).toBe(false);
    expect(state.insertedShares).toHaveLength(0);
  });

  it('emails the recipient when the buyer asked us to', async () => {
    const result = await startFreeGiftAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'send_to_recipient',
      recipientContact: 'friend@example.com',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.emailed).toBe(true);
    expect(state.emails).toHaveLength(1);
    expect(state.emails[0].to).toBe('friend@example.com');
    expect(state.emails[0].giftTitle).toBe(FREE_GIFT.title);
    expect(state.emails[0].buyerName).toBe('Ada Lovelace');
  });

  it('keeps the share when the email fails — the link still reaches the buyer', async () => {
    // Resend is not configured in production yet (OOP-6168), so this is
    // the normal production outcome, not an edge case.
    state.emailResult = { ok: false, error: 'RESEND_API_KEY is not set.' };

    const result = await startFreeGiftAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'send_to_recipient',
      recipientContact: 'friend@example.com',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.emailed).toBe(false);
    expect(result.shareUrl).toContain('/g/');
    expect(state.insertedShares).toHaveLength(1);
  });

  it('does not email when the buyer keeps the link for themselves', async () => {
    await startFreeGiftAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'buyer_shares',
    });

    expect(state.emails).toHaveLength(0);
  });

  it('fails cleanly when the share cannot be inserted', async () => {
    state.shareInsertError = { message: 'permission denied for table shares' };

    const result = await startFreeGiftAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(false);
  });

  it('accepts a seeded-style gift id', async () => {
    // The catalogue is seeded with `aaaa1111-0000-0000-0000-…` ids.
    // Those are valid Postgres uuids but not RFC 4122 ones, so Zod's
    // `z.string().uuid()` rejected every seeded listing with "giftId
    // must be a UUID." — the free path could never have reached a
    // seeded gift.
    state.gift = { ...FREE_GIFT, id: 'aaaa1111-0000-0000-0000-000000000001' };

    const result = await startFreeGiftAction({
      giftId: 'aaaa1111-0000-0000-0000-000000000001',
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(true);
    expect(state.insertedShares).toHaveLength(1);
  });

  it('rejects a malformed gift id', async () => {
    const result = await startFreeGiftAction({
      giftId: 'not-a-uuid',
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('giftId must be a UUID');
    expect(state.insertedShares).toHaveLength(0);
  });
});

describe('startCheckoutSessionAction (the paid path)', () => {
  it('never opens a Stripe session for a free gift', async () => {
    // The dead end this issue is about. The paid action must refuse a
    // free gift WITHOUT creating a session — and the message must not
    // be the old dead-end wording, because a live listing can no
    // longer reach this branch at all.
    const result = await startCheckoutSessionAction({
      giftId: FREE_GIFT.id,
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain('no checkout needed');
    expect(state.stripeSessionsCreated).toBe(0);
  });

  it('still opens a Stripe session for a paid gift', async () => {
    state.gift = { ...PAID_GIFT };

    const result = await startCheckoutSessionAction({
      giftId: PAID_GIFT.id,
      deliveryMode: 'buyer_shares',
    });

    expect(result.ok).toBe(true);
    expect(state.stripeSessionsCreated).toBe(1);
  });
});
