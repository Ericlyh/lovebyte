import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';

/**
 * OOP-6727 — the URLs a crawler and a social card need.
 *
 * The site serves ONE address per page. The locale lives in a cookie and
 * the proxy rewrites it in and out of the path, so `/browse` is the only
 * URL that page has — there is no `/en/browse`. Every reference to a
 * page therefore has to name that one address, or a crawler sees the
 * same content at two URLs and splits its ranking between them.
 *
 * That is what `canonicalUrl` is for. Before this, nothing in the app
 * emitted `alternates.canonical` at all, so a search engine was free to
 * treat the locale-prefixed internal path, the alias host and the
 * canonical host as three separate pages.
 */

/**
 * The absolute canonical URL of a public path.
 *
 * `path` is the locale-less public path — `/browse`, `/l/<id>`,
 * `/gifts/memory-cards`. The root path is the bare origin, without a
 * trailing slash, because `https://lovorithm.vercel.app/` and
 * `https://lovorithm.vercel.app` are two strings and only one of them
 * should ever be canonical.
 *
 * The root keeps its trailing slash, because that is the form the
 * sitemap has always emitted and the form `homeUrl()` in
 * `src/lib/seo/jsonld.ts` emits — one URL per page, spelled once.
 */
export function canonicalUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return clean === '/' ? `${BRAND.PRODUCTION_URL}/` : `${BRAND.PRODUCTION_URL}${clean}`;
}

/** The social card for one marketplace listing. */
export function listingOgImage(giftId: string): string {
  return `${BRAND.PRODUCTION_URL}/api/og/listing/${encodeURIComponent(giftId)}`;
}

/** The social card for a page — `/browse` or one of the gift guides. */
export function pageOgImage(slug: string): string {
  return `${BRAND.PRODUCTION_URL}/api/og/page/${encodeURIComponent(slug)}`;
}

/** The static brand card, used by the pages that have no bespoke one. */
export const BRAND_OG_IMAGE = `${BRAND.PRODUCTION_URL}/og.png`;

export type PublicRoute = {
  path: string;
  priority: number;
  changeFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
};

/**
 * The evergreen public pages, in the order a crawler should meet them.
 *
 * `/status` was missing from this list even though it is a public page
 * linked from the footer of every legal page — a crawler that arrives
 * on `/privacy` and follows the footer finds a page the sitemap never
 * mentions.
 */
export const PUBLIC_ROUTES: PublicRoute[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/browse', priority: 0.9, changeFrequency: 'daily' },
  { path: '/gifts', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/support', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/status', priority: 0.3, changeFrequency: 'daily' },
  { path: '/privacy', priority: 0.2, changeFrequency: 'yearly' },
  { path: '/terms', priority: 0.2, changeFrequency: 'yearly' },
];

export type PageSeo = {
  /** The canonical path of the page, e.g. `/browse`. */
  path: string;
  /** The page title, without the brand suffix. */
  title: string;
  description: string;
  /** The absolute URL of the social card image. */
  imageUrl: string;
};

/**
 * The metadata every indexable page carries: its own title, its own
 * description, a canonical URL and a social card.
 *
 * Why this is a helper and not nine hand-written `metadata` objects:
 * Next.js REPLACES a parent's `openGraph` and `twitter` wholesale when a
 * child defines them (see `mergeMetadata` in
 * next/dist/lib/metadata/resolve-metadata.js — there is no deep merge for
 * those two keys). So a page that sets `openGraph.images` and forgets
 * `twitter` keeps the parent's Twitter card — the old brand card, under
 * the new title. Building all four fields in one place is what keeps
 * that from happening.
 */
export function buildMetadata(seo: PageSeo): Metadata {
  const url = canonicalUrl(seo.path);
  const title = `${seo.title} — ${BRAND.NAME}`;

  return {
    title,
    description: seo.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: BRAND.NAME,
      locale: 'en_GB',
      title,
      description: seo.description,
      url,
      images: [{ url: seo.imageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: seo.description,
      images: [seo.imageUrl],
    },
  };
}
