import { describe, expect, it, vi } from 'vitest';

// The anon helper validates its env at IMPORT time.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';

/**
 * The edge-cache contract for the read-only responses (OOP-6724).
 *
 * Every social unfurl and every crawler hit used to re-render work that
 * was already done: the OG card re-encoded a 1200×630 PNG and re-read
 * the share, and the JSON APIs re-read the thread. The responses are
 * cached at the edge now, and the cache lifetime is part of the
 * contract — so it is pinned here, in one place, for all of them.
 *
 * A cache lifetime is only safe because the response is role-independent.
 * That half of the contract is pinned by
 * `src/lib/catalog.public-reads.test.ts` (the reads are cookie-free) and
 * by the identity-diff proof on the issue.
 */

vi.mock('@/lib/catalog', () => ({
  getCatalogFeed: vi.fn(async () => ({ gifts: [], nextCursor: null })),
  getListingComments: vi.fn(async () => ({
    comments: [],
    nextCursor: null,
    totalCount: 0,
  })),
  getListingReplies: vi.fn(async () => ({
    replies: [],
    nextCursor: null,
    totalCount: 0,
  })),
  getPublicListingDetail: vi.fn(async () => null),
}));

vi.mock('@/lib/gifts/fetch', () => ({
  getPublicEnvelopeByToken: vi.fn(async () => ({
    shareToken: 'demo',
    giftType: 'animated_letter',
    senderName: 'Eric',
    sentAtIso: '2026-10-29T00:00:00.000Z',
    payload: {},
  })),
}));

import { NextRequest } from 'next/server';
import { GET as ogShare } from './og/[shareToken]/route';
import { GET as ogListing } from './og/listing/[giftId]/route';
import { GET as ogPage } from './og/page/[slug]/route';
import { GET as feed } from './catalog/feed/route';
import { GET as comments } from './gift-comments/[giftId]/route';
import { GET as replies } from './gift-replies/[giftId]/route';

const GIFT_ID = 'aaaa1111-0000-0000-0000-000000000001';

/** The thread APIs share one lifetime; the feed is not a thread. */
const THREAD_CACHE = 'public, s-maxage=30, stale-while-revalidate=60';

describe('the OG card is cached as immutable (OOP-6724)', () => {
  it('/api/og/{token} — a year, because the token → envelope mapping never changes', async () => {
    const res = await ogShare(
      new NextRequest('https://lovorithm.vercel.app/api/og/demo'),
      { params: Promise.resolve({ shareToken: 'demo' }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });

  it('/api/og/listing/{giftId} — cached, but not immutable: a listing can be unlisted', async () => {
    const res = await ogListing(new Request('https://lovorithm.vercel.app/'), {
      params: Promise.resolve({ giftId: GIFT_ID }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=3600',
    );
  });

  it('/api/og/page/{slug} — cached, but not immutable: the card text lives in the code', async () => {
    const res = await ogPage(new Request('https://lovorithm.vercel.app/'), {
      params: Promise.resolve({ slug: 'browse' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=3600',
    );
  });
});

describe('the read-only JSON APIs are cached at the edge (OOP-6724)', () => {
  it('/api/gift-comments/{id}', async () => {
    const res = await comments(
      new Request(`https://lovorithm.vercel.app/api/gift-comments/${GIFT_ID}`),
      { params: Promise.resolve({ giftId: GIFT_ID }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(THREAD_CACHE);
  });

  it('/api/gift-replies/{id}', async () => {
    const res = await replies(
      new Request(`https://lovorithm.vercel.app/api/gift-replies/${GIFT_ID}`),
      { params: Promise.resolve({ giftId: GIFT_ID }) },
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(THREAD_CACHE);
  });

  it('/api/catalog/feed — no longer no-store, now the same short lifetime', async () => {
    const res = await feed(
      new NextRequest('https://lovorithm.vercel.app/api/catalog/feed'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(THREAD_CACHE);
    expect(res.headers.get('cache-control')).not.toContain('no-store');
  });
});
