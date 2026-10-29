import { beforeEach, describe, expect, it, vi } from 'vitest';
import { republishGiftAction, unpublishGiftAction } from './listing';

/**
 * Tests for the unpublish / re-publish actions (OOP-6719).
 *
 * A creator who cannot take down a listing that embarrasses them will
 * stop creating — and `docs/USER-FLOWS.md` had claimed `unpublishGiftAction`
 * existed since M-F, when it had never been written.
 *
 * These tests pin the parts that matter:
 *
 *   - unpublishing sets `gifts.deleted_at` (the marketplace-v2 convention)
 *     AND clears `is_listed`, so the listing leaves both the catalogue
 *     policy and any `is_listed`-only query
 *   - a listing that was never published cannot be unpublished
 *   - a gift you do not own is refused (the RLS would refuse the write
 *     too; the action refuses it earlier, with a readable message)
 *   - re-publishing clears `deleted_at`, restores `is_listed` and
 *     refreshes `published_at` so the listing returns to the top
 *   - the paths that show the listing are revalidated
 */

const OWNER_ID = '11111111-1111-1111-1111-111111111111';

const { state, fakeFrom } = vi.hoisted(() => {
  const state = {
    /** The signed-in creator. `null` = signed out. */
    user: { id: '11111111-1111-1111-1111-111111111111' } as { id: string } | null,
    /** The gift row the read resolves to. `null` = not found / not yours. */
    gift: null as Record<string, unknown> | null,
    giftError: null as { message: string } | null,
    /** Every write the action attempted. */
    updates: [] as Record<string, unknown>[],
    updateError: null as { message: string } | null,
    /** Every path the action asked Next to revalidate. */
    revalidated: [] as string[],
  };

  /**
   * A minimal stand-in for the cookie-bound Supabase client. The action
   * only calls `select().eq().eq().maybeSingle()` and
   * `update().eq().eq()` on `gifts` — so that is all this fakes.
   */
  const fakeFrom = (table: string) => ({
    select: () => {
      const builder: Record<string, unknown> = {};
      builder.eq = () => builder;
      builder.maybeSingle = async () => {
        if (table === 'gifts') return { data: state.gift, error: state.giftError };
        return { data: null, error: null };
      };
      return builder;
    },
    update: (patch: Record<string, unknown>) => {
      state.updates.push(patch);
      const builder: Record<string, unknown> = {};
      builder.eq = () => builder;
      // The real builder is a PromiseLike — `await ...update().eq().eq()`
      // resolves to `{ error }`.
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: null, error: state.updateError }).then(
          onFulfilled,
          onRejected,
        );
      return builder;
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

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));

/** A live, listed gift. */
const LISTED_GIFT = {
  id: 'aaaa1111-0000-0000-0000-000000000001',
  is_listed: true,
  deleted_at: null,
  published_at: '2026-08-26T07:42:26.977303+00:00',
  owner: { handle: 'mei' },
};

/** The same gift after it has been unpublished. */
const UNPUBLISHED_GIFT = {
  ...LISTED_GIFT,
  is_listed: false,
  deleted_at: '2026-10-29T04:00:00.000Z',
};

/** A draft — never listed, so there is nothing on the market to take down. */
const DRAFT_GIFT = {
  ...LISTED_GIFT,
  is_listed: false,
  deleted_at: null,
  published_at: null,
};

beforeEach(() => {
  state.user = { id: OWNER_ID };
  state.gift = { ...LISTED_GIFT };
  state.giftError = null;
  state.updates = [];
  state.updateError = null;
  state.revalidated = [];
});

describe('unpublishGiftAction', () => {
  it('sets deleted_at and clears is_listed', async () => {
    const result = await unpublishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(true);
    expect(state.updates).toHaveLength(1);

    const patch = state.updates[0];
    // The marketplace-v2 convention: `deleted_at` is set when a listing
    // is unpublished. The catalogue policy
    // (`is_listed = true and published_at is not null and deleted_at is null`)
    // then hides the row from /browse, the JSON feed and the sitemap.
    expect(patch.deleted_at).toBeTruthy();
    expect(typeof patch.deleted_at).toBe('string');
    // `is_listed` goes too — the two say the same thing, and a query
    // that filters only on `is_listed` would otherwise still show it.
    expect(patch.is_listed).toBe(false);
  });

  it('revalidates the surfaces that show the listing', async () => {
    await unpublishGiftAction({ giftId: LISTED_GIFT.id });

    expect(state.revalidated).toContain(`/l/${LISTED_GIFT.id}`);
    expect(state.revalidated).toContain('/browse');
    expect(state.revalidated).toContain('/sitemap.xml');
    expect(state.revalidated).toContain('/u/mei');
  });

  it('refuses an already-unpublished listing', async () => {
    state.gift = { ...UNPUBLISHED_GIFT };

    const result = await unpublishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already unpublished/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a gift that was never listed', async () => {
    state.gift = { ...DRAFT_GIFT };

    const result = await unpublishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not listed/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses a gift the caller does not own', async () => {
    // RLS `gifts_select_own` is `auth.uid() = owner_id`, so a gift
    // belonging to somebody else reads back as nothing.
    state.gift = null;

    const result = await unpublishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/do not own/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses an unauthenticated caller', async () => {
    state.user = null;

    const result = await unpublishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
    expect(state.updates).toHaveLength(0);
  });

  it('rejects a malformed gift id', async () => {
    const result = await unpublishGiftAction({ giftId: 'not-a-uuid' });

    expect(result.ok).toBe(false);
    expect(state.updates).toHaveLength(0);
  });

  it('reports a failed write instead of pretending it worked', async () => {
    state.updateError = { message: 'boom' };

    const result = await unpublishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/could not unpublish/i);
  });
});

describe('republishGiftAction', () => {
  it('clears deleted_at and restores is_listed', async () => {
    state.gift = { ...UNPUBLISHED_GIFT };

    const result = await republishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(true);
    expect(state.updates).toHaveLength(1);

    const patch = state.updates[0];
    expect(patch.deleted_at).toBeNull();
    expect(patch.is_listed).toBe(true);
    // The listing comes back to the top of the catalogue rather than
    // resurfacing where it was months ago.
    expect(patch.published_at).toBeTruthy();
  });

  it('revalidates the surfaces that show the listing', async () => {
    state.gift = { ...UNPUBLISHED_GIFT };

    await republishGiftAction({ giftId: LISTED_GIFT.id });

    expect(state.revalidated).toContain(`/l/${LISTED_GIFT.id}`);
    expect(state.revalidated).toContain('/browse');
    expect(state.revalidated).toContain('/sitemap.xml');
  });

  it('refuses a listing that is already published', async () => {
    const result = await republishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/already published/i);
    expect(state.updates).toHaveLength(0);
  });

  it('refuses an unauthenticated caller', async () => {
    state.user = null;
    state.gift = { ...UNPUBLISHED_GIFT };

    const result = await republishGiftAction({ giftId: LISTED_GIFT.id });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('unauthenticated');
    expect(state.updates).toHaveLength(0);
  });
});
