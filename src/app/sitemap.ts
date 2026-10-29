import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';
import { getCatalogFeed } from '@/lib/catalog';
import type { CatalogGift } from '@/lib/catalog';
import { GIFT_PAGES } from '@/content/gifts';
import { PUBLIC_ROUTES } from '@/lib/seo/metadata';

/**
 * GET /sitemap.xml — the pages a crawler should index.
 *
 * OOP-5816: the site had no sitemap (404). For a marketplace, the
 * listings ARE the product: a gift that nobody can find is a gift that
 * nobody buys. Every listed gift gets a URL here, plus the creator
 * profile that owns it.
 *
 * `force-dynamic` matters: a statically rendered sitemap is frozen at
 * BUILD time, and the catalog is empty at build time — the sitemap would
 * ship with zero listings and never grow. The feed is one indexed query
 * (the same one /browse uses), so this stays cheap.
 *
 * OOP-6727: the sitemap now names every public route — including
 * `/status`, which is linked from the footer of every legal page but was
 * never listed here, and `/gifts`, which is the hub the guides hang
 * from. The route list lives in `src/lib/seo/metadata.ts` next to the
 * canonical-URL builder, so a page's canonical URL and its sitemap entry
 * are the same string by construction.
 *
 * OOP-6730: the sitemap used to read the catalog feed ONCE. The feed's
 * page is 20 rows, so from the 21st listing onwards this route served a
 * sitemap that silently dropped the catalogue's oldest listings — while
 * still returning 200 and looking healthy. A marketplace that grows past
 * 20 products loses its oldest products from the index with no error.
 * The fix is to follow the feed's `nextCursor` to the end of the
 * catalogue.
 */

/** The gift guides. Their copy changes when the product changes, not daily. */
const GIFT_ROUTES: MetadataRoute.Sitemap = GIFT_PAGES.map((page) => ({
  url: `${BRAND.PRODUCTION_URL}/gifts/${page.slug}`,
  lastModified: new Date(),
  changeFrequency: 'monthly',
  priority: 0.7,
}));

/**
 * How many listings one page of the sitemap's catalog read asks for.
 *
 * The feed's own page is 20 rows — a screenful for /browse. The sitemap
 * needs EVERY listing, and at 20 a row its page count grows with the
 * catalogue: 9 listings is one round trip today, 2,000 listings would be
 * 100 of them, and each one is a PostgREST round trip from the edge
 * (iad1) to Supabase (hkg) costing about half a second. 200 listings a
 * page turns those 100 into 10.
 */
const SITEMAP_PAGE_SIZE = 200;

/**
 * The most listings one sitemap response may carry.
 *
 * Google allows 50,000 URLs per sitemap, so the URL limit is never the
 * binding constraint — the request budget is. Ten pages of 200 is ~2,000
 * listings in ~5s, inside the function timeout.
 *
 * Past this the sitemap has to SPLIT, not grow: a sitemap INDEX with
 * several sitemaps under this cap. If the cap is reached we say so in
 * the server log, loudly — a sitemap that quietly stops at the cap is
 * the exact failure this route was fixed for.
 */
const MAX_SITEMAP_LISTINGS = 2_000;

/**
 * Every listed gift, following the feed's cursor to the end of the
 * catalogue.
 *
 * The feed hands back a `nextCursor` with every page; this follows it
 * until it comes back null. That is the only definition of "all the
 * listings" that stays true as the catalogue grows — one page of 20 is
 * silently wrong from the 21st listing onwards.
 *
 * Two stops other than "the catalogue is exhausted", both loud:
 *
 *   • the feed repeated a cursor — the loop would never end, so we stop
 *     rather than hang the route;
 *   • the catalogue is past `MAX_SITEMAP_LISTINGS` — the sitemap is
 *     capped and needs to become a sitemap index.
 */
async function collectListings(): Promise<CatalogGift[]> {
  const listings: CatalogGift[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (;;) {
    const { gifts, nextCursor } = await getCatalogFeed(
      { sort: 'published_desc', cursor },
      { pageSize: SITEMAP_PAGE_SIZE },
    );

    for (const gift of gifts) {
      if (seenIds.has(gift.id)) continue;
      seenIds.add(gift.id);
      listings.push(gift);
    }

    // The catalogue is exhausted — this is the whole of it.
    if (!nextCursor) return listings;

    if (seenCursors.has(nextCursor)) {
      console.error(
        '[sitemap] the catalog feed repeated a cursor — the sitemap stopped early',
      );
      return listings;
    }
    seenCursors.add(nextCursor);

    if (listings.length >= MAX_SITEMAP_LISTINGS) {
      console.error(
        `[sitemap] the catalogue has more than ${MAX_SITEMAP_LISTINGS} listings — this sitemap is capped and needs to be split into a sitemap index`,
      );
      return listings;
    }

    cursor = nextCursor;
  }
}

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((r) => ({
    url: `${BRAND.PRODUCTION_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  let listingEntries: MetadataRoute.Sitemap = [];
  let profileEntries: MetadataRoute.Sitemap = [];
  const seenProfiles = new Set<string>();

  try {
    const gifts = await collectListings();

    listingEntries = gifts.map((gift) => ({
      url: `${BRAND.PRODUCTION_URL}/l/${gift.id}`,
      lastModified: new Date(gift.published_at),
      changeFrequency: 'weekly',
      priority: 0.8,
    }));

    profileEntries = gifts
      .filter((gift) => {
        if (seenProfiles.has(gift.owner.handle)) return false;
        seenProfiles.add(gift.owner.handle);
        return true;
      })
      .map((gift) => ({
        url: `${BRAND.PRODUCTION_URL}/u/${gift.owner.handle}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.5,
      }));
  } catch (err) {
    // A sitemap that lists the static pages is still useful; a sitemap
    // that 500s is not. Never fail the whole route on a catalog read —
    // but say what happened, because a silent drop is what this route
    // was fixed for.
    console.error('[sitemap] the catalog read failed', err);
  }

  return [...staticEntries, ...GIFT_ROUTES, ...listingEntries, ...profileEntries];
}
