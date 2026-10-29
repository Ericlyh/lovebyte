import { beforeEach, describe, expect, it, vi } from 'vitest';

// The anon helper validates its env at IMPORT time.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';

/**
 * The reads behind the edge cache are cookie-free (OOP-6724).
 *
 * `/api/gift-comments/{id}`, `/api/gift-replies/{id}` and `/api/catalog/feed`
 * are cached at the edge, which is only safe if the response cannot depend
 * on WHO is asking. A cookie-bound read would send the visitor's session
 * JWT, so the cached copy would be whatever the first visitor's session
 * produced — and every other visitor would be served it.
 *
 * So the reads that feed the cached responses go through the anonymous
 * client. The mock below makes the cookie-bound client THROW, so a
 * regression fails loudly instead of quietly reintroducing a session
 * dependency into a cached response.
 */

const calls = vi.hoisted(() => ({ public: 0, server: 0 }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    calls.server++;
    throw new Error(
      'the cookie-bound client must not serve a read that is cached at the edge',
    );
  },
}));

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => {
    calls.public++;
    return {
      from: () => {
        const chain = (result: unknown) => {
          const self: Record<string, unknown> = {};
          const passthrough = () => self;
          self.select = passthrough;
          self.eq = passthrough;
          self.is = passthrough;
          self.not = passthrough;
          self.order = passthrough;
          self.limit = passthrough;
          self.or = passthrough;
          self.then = (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
          return self;
        };

        const rows = chain({ data: [], count: 0, error: null });
        // `maybeSingle()` resolves a single row — there are none.
        rows.maybeSingle = () => chain({ data: null, count: 0, error: null });
        return rows;
      },
    };
  },
}));

import { getListingComments, getListingReplies } from './catalog';
import { getPublicListingDetail } from './catalog';

const GIFT_ID = 'aaaa1111-0000-0000-0000-000000000001';

beforeEach(() => {
  calls.public = 0;
  calls.server = 0;
});

describe('cached reads are cookie-free (OOP-6724)', () => {
  it('getListingComments reads through the anonymous client', async () => {
    const result = await getListingComments(GIFT_ID, null);

    expect(result).toEqual({ comments: [], nextCursor: null, totalCount: 0 });
    expect(calls.public).toBe(1);
    expect(calls.server).toBe(0);
  });

  it('getListingReplies reads through the anonymous client', async () => {
    const result = await getListingReplies(GIFT_ID, null);

    expect(result).toEqual({ replies: [], nextCursor: null, totalCount: 0 });
    expect(calls.public).toBe(1);
    expect(calls.server).toBe(0);
  });

  it('getPublicListingDetail reads through the anonymous client', async () => {
    const listing = await getPublicListingDetail(GIFT_ID);

    // The fake row is empty, so the listing does not resolve — what
    // matters is that it resolved WITHOUT touching the cookie client.
    expect(listing).toBeNull();
    expect(calls.public).toBe(1);
    expect(calls.server).toBe(0);
  });
});
