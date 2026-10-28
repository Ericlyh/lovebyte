import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';
import { getCatalogFeed } from '@/lib/catalog';

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
 */

/** Public, evergreen pages. Auth + private surfaces are in robots.txt. */
const STATIC_ROUTES: {
  path: string;
  priority: number;
  changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
}[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/browse', priority: 0.9, changeFrequency: 'daily' },
  { path: '/support', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.2, changeFrequency: 'yearly' },
];

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
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

  return [...staticEntries, ...listingEntries, ...profileEntries];
}
