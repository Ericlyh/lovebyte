import { describe, expect, it } from 'vitest';
import { BRAND } from '@/lib/brand';
import {
  BRAND_OG_IMAGE,
  PUBLIC_ROUTES,
  buildMetadata,
  canonicalUrl,
  listingOgImage,
  pageOgImage,
} from './metadata';

/**
 * OOP-6727 — the metadata every indexable page carries.
 *
 * The bug these lock down: Next REPLACES a parent's `openGraph` and
 * `twitter` wholesale when a child defines them (see `mergeMetadata` in
 * next/dist/lib/metadata/resolve-metadata.js — there is no deep merge
 * for those two keys). A page that set `openGraph.images` and forgot
 * `twitter` therefore kept the ROOT layout's Twitter card: the generic
 * brand image under the page's own title.
 */

describe('canonicalUrl', () => {
  it('names the canonical host', () => {
    expect(canonicalUrl('/browse')).toBe(`${BRAND.PRODUCTION_URL}/browse`);
    expect(canonicalUrl('/l/abc')).toBe(`${BRAND.PRODUCTION_URL}/l/abc`);
  });

  it('keeps the root slash, the way the sitemap spells it', () => {
    expect(canonicalUrl('/')).toBe(`${BRAND.PRODUCTION_URL}/`);
  });

  it('adds the leading slash a caller forgot', () => {
    expect(canonicalUrl('browse')).toBe(`${BRAND.PRODUCTION_URL}/browse`);
  });

  it('produces the same string as the structured data helpers', () => {
    // `src/lib/seo/jsonld.ts` (OOP-6728) spells the listing URL out
    // separately. The canonical tag, the sitemap and the JSON-LD have
    // to agree on which URL a gift lives at.
    expect(canonicalUrl('/l/abc')).toBe(`${BRAND.PRODUCTION_URL}/l/abc`);
  });
});

describe('buildMetadata', () => {
  const meta = buildMetadata({
    path: '/browse',
    title: 'Browse personalised digital gifts',
    description: 'A description.',
    imageUrl: `${BRAND.PRODUCTION_URL}/api/og/page/browse`,
  });

  it('sets a canonical URL for the page', () => {
    expect(meta.alternates?.canonical).toBe(`${BRAND.PRODUCTION_URL}/browse`);
  });

  it('sets the social card and the Twitter card together', () => {
    expect(meta.openGraph?.images).toBeDefined();
    expect(meta.twitter?.images).toBeDefined();
  });

  it('uses the card for both, so the two unfurls match', () => {
    const og = meta.openGraph?.images as { url: string }[];
    const tw = meta.twitter?.images as string[];
    expect(og[0].url).toBe(tw[0]);
  });

  it('puts the brand in the title', () => {
    expect(meta.title).toBe(`Browse personalised digital gifts — ${BRAND.NAME}`);
  });
});

describe('the social card URLs', () => {
  it('points the listing card at the listing route', () => {
    expect(listingOgImage('abc')).toBe(
      `${BRAND.PRODUCTION_URL}/api/og/listing/abc`,
    );
  });

  it('points the page card at the page route', () => {
    expect(pageOgImage('memory-cards')).toBe(
      `${BRAND.PRODUCTION_URL}/api/og/page/memory-cards`,
    );
  });

  it('escapes a slug that needs it', () => {
    expect(pageOgImage('a/b')).toContain('a%2Fb');
  });
});

describe('PUBLIC_ROUTES', () => {
  it('lists /status, which the legal pages link to but the sitemap did not', () => {
    expect(PUBLIC_ROUTES.map((r) => r.path)).toContain('/status');
  });

  it('lists the gift guide hub', () => {
    expect(PUBLIC_ROUTES.map((r) => r.path)).toContain('/gifts');
  });

  it('has no duplicate paths', () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('BRAND_OG_IMAGE', () => {
  it('is the static brand card on the canonical host', () => {
    expect(BRAND_OG_IMAGE).toBe(`${BRAND.PRODUCTION_URL}/og.png`);
  });
});
