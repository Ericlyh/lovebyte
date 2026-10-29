import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';
import { getCatalogFeed } from '@/lib/catalog';
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
 */

/** The gift guides. Their copy changes when the product changes, not daily. */
const GIFT_ROUTES: MetadataRoute.Sitemap = GIFT_PAGES.map((page) => ({
  url: `${BRAND.PRODUCTION_URL}/gifts/${page.slug}`,
  lastModified: new Date(),
  changeFrequency: 'monthly',
  priority: 0.7,
}));

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
    const { gifts } = await getCatalogFeed({ sort: 'published_desc' });

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
  } catch {
    // A sitemap that lists the static pages is still useful; a sitemap
    // that 500s is not. Never fail the whole route on a catalog read.
  }

  return [...staticEntries, ...GIFT_ROUTES, ...listingEntries, ...profileEntries];
}
