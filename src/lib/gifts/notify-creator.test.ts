import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyGiftCreatorOfReply } from './notify-creator';

/**
 * Tests for the creator notification (OOP-6718).
 *
 * The three I/O edges are stubbed — the service-role Supabase client,
 * the GoTrue admin email lookup, and the Resend sender. What is under
 * test is the decision logic:
 *
 *   - somebody ELSE replies   → exactly one notification
 *   - the creator replies     → no notification (they already know)
 *   - the gift has no creator → no notification, no crash
 */

const state = vi.hoisted(() => ({
  gift: {
    id: 'aaaa1111-0000-0000-0000-000000000001',
    title: 'Match the Goa sunsets',
    owner_id: 'creator-1',
  } as { id: string; title: string | null; owner_id: string } | null,
  giftError: null as { message: string } | null,
  profile: {
    display_name: 'Mei Chen',
    preferred_language: 'en',
  } as { display_name: string | null; preferred_language: string | null } | null,
  ownerEmail: { state: 'found', userId: 'creator-1', email: 'mei@example.com' } as
    | { state: 'found'; userId: string; email: string }
    | { state: 'not_found' },
  emails: [] as {
    to: string;
    creatorName: string | null;
    giftTitle: string | null;
    listingPath: string;
    replyerName: string;
    replyBody: string;
    locale: string;
  }[],
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === 'gifts'
              ? { data: state.gift, error: state.giftError }
              : { data: state.profile, error: null },
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  lookupUserEmailById: async () => ({ data: state.ownerEmail, error: null }),
}));

vi.mock('@/lib/email', () => ({
  sendCreatorReplyEmail: async (args: (typeof state.emails)[number]) => {
    state.emails.push(args);
    return { ok: true, id: 'resend-123' };
  },
}));

beforeEach(() => {
  state.gift = {
    id: 'aaaa1111-0000-0000-0000-000000000001',
    title: 'Match the Goa sunsets',
    owner_id: 'creator-1',
  };
  state.giftError = null;
  state.profile = { display_name: 'Mei Chen', preferred_language: 'en' };
  state.ownerEmail = { state: 'found', userId: 'creator-1', email: 'mei@example.com' };
  state.emails = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifyGiftCreatorOfReply', () => {
  it('sends exactly one notification to the creator', async () => {
    await notifyGiftCreatorOfReply({
      giftId: 'aaaa1111-0000-0000-0000-000000000001',
      replyerId: 'buyer-1',
      replyerName: 'Jamie',
      replyBody: 'Does it ship to Bangkok?',
    });

    expect(state.emails).toHaveLength(1);
    expect(state.emails[0]).toEqual({
      to: 'mei@example.com',
      creatorName: 'Mei Chen',
      giftTitle: 'Match the Goa sunsets',
      listingPath: '/l/aaaa1111-0000-0000-0000-000000000001',
      replyerName: 'Jamie',
      replyBody: 'Does it ship to Bangkok?',
      locale: 'en',
    });
  });

  it('sends nothing when the creator replies to themselves', async () => {
    await notifyGiftCreatorOfReply({
      giftId: 'aaaa1111-0000-0000-0000-000000000001',
      replyerId: 'creator-1',
      replyerName: 'Mei Chen',
      replyBody: 'Thanks for asking!',
    });

    expect(state.emails).toHaveLength(0);
  });

  it('writes the notification in the creator’s language', async () => {
    state.profile = { display_name: '陳美', preferred_language: 'zh-Hant' };

    await notifyGiftCreatorOfReply({
      giftId: 'aaaa1111-0000-0000-0000-000000000001',
      replyerId: 'buyer-1',
      replyerName: 'Jamie',
      replyBody: '會送去曼谷㗎嗎？',
    });

    expect(state.emails[0]?.locale).toBe('zh-Hant');
  });

  it('sends nothing when the gift has no row', async () => {
    state.gift = null;

    await notifyGiftCreatorOfReply({
      giftId: 'aaaa1111-0000-0000-0000-000000000001',
      replyerId: 'buyer-1',
      replyerName: 'Jamie',
      replyBody: 'Hello?',
    });

    expect(state.emails).toHaveLength(0);
  });

  it('sends nothing when the creator has no reachable email address', async () => {
    state.ownerEmail = { state: 'not_found' };

    await notifyGiftCreatorOfReply({
      giftId: 'aaaa1111-0000-0000-0000-000000000001',
      replyerId: 'buyer-1',
      replyerName: 'Jamie',
      replyBody: 'Hello?',
    });

    expect(state.emails).toHaveLength(0);
  });
});
