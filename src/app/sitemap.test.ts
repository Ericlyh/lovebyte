import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sitemap has to list EVERY listing (OOP-6730).
 *
 * The bug: the route read the catalog feed ONCE, and the feed's page is
 * 20 rows. From the 21st listing onwards the sitemap quietly dropped
 * the catalogue's oldest listings — while still returning 200 and still
 * looking healthy. A marketplace that grows past 20 products loses its
 * oldest products from the index, with no error anywhere.
 *
 * These tests pin the three things that has to hold:
 *
 *   1. the route follows the feed's `nextCursor` until the feed says
 *      there is no more;
 *   2. every listing — including the OLDEST one — ends up in the
 *      sitemap, exactly once;
 *   3. `/status` is in there too, and a repeated creator is only
 *      listed once.
 */

type FeedGift = {
  id: string;
  published_at: string;
  owner: { id: string; handle: string; display_name: string | null };
};

/**
 * A catalogue of 225 listings — more than the 200 the sitemap asks for
 * in one page, so the route has to follow the cursor to a second page.
 * That is the whole point: the sitemap used to read ONE page of the
 * feed and stop.
 */
const CATALOGUE: FeedGift[] = Array.from({ length: 225 }, (_, i) => ({
  id: `gift-${String(i).padStart(3, '0')}`,
  published_at: new Date(Date.UTC(2026, 7, 25) - i * 86_400_000).toISOString(),
  owner: {
    id: 'p1',
    handle: i % 2 === 0 ? 'ada' : 'mei',
    display_name: 'Ada',
  },
}));

const { getCatalogFeed } = vi.hoisted(() => ({ getCatalogFeed: vi.fn() }));

vi.mock('@/lib/catalog', () => ({
  getCatalogFeed,
}));

import sitemap from './sitemap';

beforeEach(() => {
  getCatalogFeed.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A feed that pages like the real one: 20 rows a page and a cursor
 * that points at the next page.
 */
function pagedFeed() {
  getCatalogFeed.mockImplementation(
    async (params: { cursor?: string }, options?: { pageSize?: number }) => {
      const pageSize = options?.pageSize ?? 20;
      const start = params.cursor
        ? CATALOGUE.findIndex((g) => g.id === params.cursor)
        : 0;
      const page = CATALOGUE.slice(start, start + pageSize);
      const more = CATALOGUE.length > start + pageSize;
      return {
        gifts: page,
        nextCursor: more ? page[page.length - 1].id : null,
      };
    },
  );
}

function urls(entries: { url: string }[]): string[] {
  return entries.map((e) => e.url);
}

describe('sitemap (OOP-6730)', () => {
  it('lists every listing, including the oldest one', async () => {
    pagedFeed();

    const entries = await sitemap();
    const listingUrls = urls(entries).filter((u) => u.includes('/l/'));

    expect(listingUrls).toHaveLength(CATALOGUE.length);
    expect(new Set(listingUrls).size).toBe(CATALOGUE.length);
    // The oldest listing is the one a single-page sitemap drops.
    expect(listingUrls).toContain(
      'https://lovorithm.vercel.app/l/gift-224',
    );
  });

  it('follows the feed cursor until the feed says there is no more', async () => {
    pagedFeed();

    await sitemap();

    // Two pages: the first with no cursor, the second with the cursor
    // the first one handed back.
    expect(getCatalogFeed).toHaveBeenCalledTimes(2);
    expect(getCatalogFeed.mock.calls[0][0]).toEqual({
      sort: 'published_desc',
      cursor: undefined,
    });
    expect(getCatalogFeed.mock.calls[1][0]).toEqual({
      sort: 'published_desc',
      cursor: 'gift-199',
    });
  });

  it('asks for a bigger page than the feed screen, so the page count stays low', async () => {
    pagedFeed();

    await sitemap();

    expect(getCatalogFeed.mock.calls[0][1]).toEqual({ pageSize: 200 });
  });

  it('includes /status and lists a creator once', async () => {
    pagedFeed();

    const entries = await sitemap();
    const all = urls(entries);

    expect(all).toContain('https://lovorithm.vercel.app/status');
    expect(all.filter((u) => u.includes('/u/'))).toEqual([
      'https://lovorithm.vercel.app/u/ada',
      'https://lovorithm.vercel.app/u/mei',
    ]);
  });

  it('a feed that never ends stops at the cap and says so', async () => {
    // A feed that always reports a next cursor would loop forever.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getCatalogFeed.mockImplementation(async () => ({
      gifts: CATALOGUE.slice(0, 20),
      nextCursor: 'same-cursor-forever',
    }));

    const entries = await sitemap();

    expect(error).toHaveBeenCalled();
    // It stopped rather than hanging the route.
    expect(getCatalogFeed.mock.calls.length).toBeLessThan(20);
  });

  it('a catalog read that throws still serves the static routes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getCatalogFeed.mockRejectedValue(new Error('supabase is down'));

    const entries = await sitemap();
    const all = urls(entries);

    expect(all).toContain('https://lovorithm.vercel.app/');
    expect(all).toContain('https://lovorithm.vercel.app/status');
    expect(all.some((u) => u.includes('/l/'))).toBe(false);
    expect(error).toHaveBeenCalled();
  });
});
