import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOwnedGifts } from './ownedGifts';

/**
 * Tests for the creator's own gift list (OOP-6719).
 *
 * The bug this pins: the select listed `like_count`, which is NOT a
 * column on `gifts` — it is a SQL aggregate exposed by the
 * `gift_like_count()` RPC. PostgREST rejected the WHOLE query with
 * `42703 column gifts.like_count does not exist`, so `getOwnedGifts`
 * returned `[]` and the owner's "My Gifts" section always rendered its
 * empty state. A creator's own library was invisible.
 *
 * It matters for this issue specifically because the unpublish button
 * lives in that grid: with the query broken, there was nothing to click.
 *
 * The other thing pinned here is that the list keeps UNPUBLISHED rows.
 * Unpublishing soft-deletes the gift, so a list that filtered those out
 * would make unpublishing a one-way door.
 */

const { state, fakeFrom } = vi.hoisted(() => {
  const state = {
    /** Every `select()` call, so the test can inspect the columns. */
    selects: [] as { table: string; cols: string }[],
    /** The rows the `gifts` query resolves to. */
    giftRows: [] as Record<string, unknown>[],
    /** The creator's profile row. */
    profile: null as Record<string, unknown> | null,
    /** What the `gift_like_count` RPC returns. */
    likeCount: 7,
  };

  const fakeFrom = (table: string) => ({
    select: (cols: string) => {
      state.selects.push({ table, cols });
      const builder: Record<string, unknown> = {};
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.maybeSingle = async () => ({
        data: table === 'profiles_public' ? state.profile : null,
        error: null,
      });
      // The real builder is a PromiseLike — the code awaits the chain.
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: table === 'gifts' ? state.giftRows : null,
          error: null,
        }).then(onFulfilled, onRejected);
      return builder;
    },
  });

  return { state, fakeFrom };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => fakeFrom(table),
    rpc: async (fn: string) => ({
      data: fn === 'gift_like_count' ? state.likeCount : null,
      error: null,
    }),
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: 'https://media.test/cover.png' } }),
      }),
    },
  }),
}));

const CREATOR_ID = '11111111-1111-1111-1111-111111111111';

/** A live, listed gift. */
const LISTED_GIFT = {
  id: 'aaaa1111-0000-0000-0000-000000000001',
  type: 'memory_cards',
  title: 'Our Sunday dim sum',
  description: null,
  category: 'memory_cards',
  price_cents: 100,
  currency: 'HKD',
  published_at: '2026-08-24T07:41:25.954751+00:00',
  is_listed: true,
  deleted_at: null,
  cover_media_id: null,
  cover: null,
  payload: {},
  created_at: '2026-08-01T00:00:00.000Z',
  owner: { id: CREATOR_ID, handle: 'mei', display_name: 'Mei Chen' },
};

/** The same gift after it has been taken off the marketplace. */
const UNPUBLISHED_GIFT = {
  ...LISTED_GIFT,
  is_listed: false,
  deleted_at: '2026-10-29T04:00:00.000Z',
};

beforeEach(() => {
  state.selects = [];
  state.giftRows = [];
  state.profile = { id: CREATOR_ID, handle: 'mei', display_name: 'Mei Chen' };
  state.likeCount = 7;
});

describe('getOwnedGifts', () => {
  it('does not select gifts.like_count — that column does not exist', async () => {
    state.giftRows = [{ ...LISTED_GIFT }];

    await getOwnedGifts('mei');

    const giftSelect = state.selects.find((s) => s.table === 'gifts');
    expect(giftSelect).toBeDefined();
    // Selecting a column that is not there makes PostgREST reject the
    // whole query, and the owner's library comes back empty.
    expect(giftSelect!.cols).not.toMatch(/like_count/);
  });

  it('reads the like count from the gift_like_count RPC', async () => {
    state.giftRows = [{ ...LISTED_GIFT }];

    const gifts = await getOwnedGifts('mei');

    expect(gifts).toHaveLength(1);
    // `like_count` is an aggregate, not a column — it comes from the RPC.
    expect(gifts[0].like_count).toBe(7);
  });

  it('returns the creator’s own gifts', async () => {
    state.giftRows = [{ ...LISTED_GIFT }];

    const gifts = await getOwnedGifts('mei');

    expect(gifts).toHaveLength(1);
    expect(gifts[0].id).toBe(LISTED_GIFT.id);
    expect(gifts[0].title).toBe('Our Sunday dim sum');
    expect(gifts[0].is_listed).toBe(true);
    expect(gifts[0].is_unpublished).toBe(false);
    expect(gifts[0].owner.handle).toBe('mei');
  });

  it('keeps an unpublished gift in the list so it can be published again', async () => {
    // Unpublishing soft-deletes the row. If the list hid those rows the
    // creator would have no way back to the listing they just took down.
    state.giftRows = [{ ...UNPUBLISHED_GIFT }];

    const gifts = await getOwnedGifts('mei');

    expect(gifts).toHaveLength(1);
    expect(gifts[0].is_unpublished).toBe(true);
    expect(gifts[0].is_listed).toBe(false);
  });

  it('returns nothing when the handle does not resolve', async () => {
    state.profile = null;

    expect(await getOwnedGifts('nobody')).toEqual([]);
  });
});
