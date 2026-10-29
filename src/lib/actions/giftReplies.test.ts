import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGiftReplyAction } from './giftReplies';

/**
 * Tests for the gift-reply action (OOP-6718 — the creator notification).
 *
 * The Supabase client is stubbed; the Zod schema, the auth gate and the
 * notification wiring are the real code path.
 *
 * What has to hold:
 *   - a reply writes to `gift_replies` and notifies the creator EXACTLY
 *     once
 *   - an unauthenticated reply inserts nothing and notifies nobody
 *   - a reply to a SEEDED gift id is accepted. `z.string().uuid()` is
 *     RFC-4122 and rejects the `aaaa1111-…` ids the catalogue uses
 *     (version nibble 0), which silently killed every reply to 8 of the
 *     9 seeded listings.
 */

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  notifications: [] as {
    giftId: string;
    replyerId: string;
    replyerName: string;
    replyBody: string;
  }[],
  authedUser: { id: 'buyer-1' } as { id: string } | null,
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => {},
}));

vi.mock('@/lib/analytics/track', () => ({
  trackEvent: async () => true,
}));

vi.mock('@/lib/gifts/notify-creator', () => ({
  notifyGiftCreatorOfReply: async (args: {
    giftId: string;
    replyerId: string;
    replyerName: string;
    replyBody: string;
  }) => {
    state.notifications.push(args);
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.authedUser } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        if (!state.insertError) state.inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: state.insertError
                ? null
                : {
                    id: 'reply-1',
                    body: row.body,
                    created_at: '2026-10-29T00:00:00.000Z',
                    parent_reply_id: row.parent_reply_id,
                    user: {
                      id: state.authedUser?.id,
                      handle: 'jamie',
                      display_name: 'Jamie',
                    },
                  },
              error: state.insertError,
            }),
          }),
        };
      },
    }),
  }),
}));

/** A seeded catalogue id — version nibble 0, so `.uuid()` rejects it. */
const SEEDED_GIFT_ID = 'aaaa1111-0000-0000-0000-000000000001';
/** The demo share's gift id — same problem. */
const DEMO_GIFT_ID = 'a000c000-0000-0000-0000-0000d3a0c0de';

beforeEach(() => {
  state.inserted = [];
  state.insertError = null;
  state.notifications = [];
  state.authedUser = { id: 'buyer-1' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createGiftReplyAction — the creator notification (OOP-6718)', () => {
  it('writes the reply to gift_replies', async () => {
    const result = await createGiftReplyAction({
      giftId: SEEDED_GIFT_ID,
      body: 'Does it ship to Bangkok?',
    });

    expect(result.ok).toBe(true);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      gift_id: SEEDED_GIFT_ID,
      user_id: 'buyer-1',
      body: 'Does it ship to Bangkok?',
    });
  });

  it('notifies the creator exactly once, with the reply body', async () => {
    await createGiftReplyAction({
      giftId: SEEDED_GIFT_ID,
      body: 'Does it ship to Bangkok?',
    });

    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]).toEqual({
      giftId: SEEDED_GIFT_ID,
      replyerId: 'buyer-1',
      replyerName: 'Jamie',
      replyBody: 'Does it ship to Bangkok?',
    });
  });

  it('accepts a seeded gift id that z.string().uuid() would reject', async () => {
    // The demo share's gift — the exact id the recipient flow hits.
    const result = await createGiftReplyAction({
      giftId: DEMO_GIFT_ID,
      body: 'This is so lovely.',
    });

    expect(result.ok).toBe(true);
    expect(state.inserted).toHaveLength(1);
    expect(state.notifications).toHaveLength(1);
  });

  it('notifies nobody when the reply is not authenticated', async () => {
    state.authedUser = null;

    const result = await createGiftReplyAction({
      giftId: SEEDED_GIFT_ID,
      body: 'Does it ship to Bangkok?',
    });

    expect(result).toEqual({ ok: false, error: 'unauthenticated' });
    expect(state.inserted).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
  });

  it('rejects an empty body before touching the database', async () => {
    const result = await createGiftReplyAction({ giftId: SEEDED_GIFT_ID, body: '   ' });

    expect(result.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
  });

  it('does not notify when the insert failed', async () => {
    state.insertError = { message: 'boom' };

    const result = await createGiftReplyAction({
      giftId: SEEDED_GIFT_ID,
      body: 'Does it ship to Bangkok?',
    });

    expect(result.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
    expect(state.notifications).toHaveLength(0);
  });
});
