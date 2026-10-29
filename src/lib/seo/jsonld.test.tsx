import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  breadcrumbJsonLd,
  browseUrl,
  homeUrl,
  listingUrl,
  organizationJsonLd,
  productJsonLd,
  profileUrl,
  websiteJsonLd,
} from './jsonld';

/**
 * OOP-6728 — the structured data on the public pages.
 *
 * These tests parse the JSON-LD back out of RENDERED HTML, the way a
 * crawler does, rather than asserting on the builder's return value.
 * The builder can be right and the page still be wrong — a script tag
 * that never renders, a payload that is not valid JSON, a block that
 * arrives after the one the page meant to publish first. Reading the
 * markup is the only way to catch those.
 */

/**
 * Every JSON-LD block in a document, in the order it appears.
 *
 * The pattern is deliberately the same shape a crawler's is: it reads
 * from `<script type="application/ld+json">` to the matching
 * `</script>`, and it does not stop at the first block.
 */
const JSON_LD_BLOCK = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

type Node = Record<string, any>;

function parseJsonLd(html: string): Node[][] {
  const blocks: Node[][] = [];
  for (const match of html.matchAll(JSON_LD_BLOCK)) {
    blocks.push(JSON.parse(match[1]));
  }
  return blocks;
}

/** The nodes of the first JSON-LD block in a document. */
function firstBlock(html: string): Node[] {
  const blocks = parseJsonLd(html);
  expect(blocks.length).toBeGreaterThan(0);
  return blocks[0];
}

/** A paid listing — the common case. */
const PAID_LISTING = {
  id: 'aaaa3333-0000-0000-0000-000000000002',
  title: 'Trivia of our first year',
  description: 'Twenty questions only we would know the answers to.',
  category: 'quiz' as const,
  priceCents: 1800,
  coverUrl: 'https://lovorithm.vercel.app/cover.jpg',
  creator: { handle: 'ada', displayName: 'Ada' },
};

describe('JSON-LD (OOP-6728)', () => {
  describe('a paid listing', () => {
    const html = renderToStaticMarkup(
      <JsonLd nodes={[productJsonLd(PAID_LISTING)]} />,
    );

    it('renders one JSON-LD script', () => {
      expect(html).toContain('<script type="application/ld+json">');
      expect(parseJsonLd(html)).toHaveLength(1);
    });

    it('publishes a Product with the listing’s own fields', () => {
      const [product] = firstBlock(html);

      expect(product['@context']).toBe('https://schema.org');
      expect(product['@type']).toBe('Product');
      expect(product.name).toBe('Trivia of our first year');
      expect(product.description).toBe(
        'Twenty questions only we would know the answers to.',
      );
      expect(product.url).toBe(
        'https://lovorithm.vercel.app/l/aaaa3333-0000-0000-0000-000000000002',
      );
    });

    it('publishes the listing’s cover as the product image', () => {
      const [product] = firstBlock(html);

      expect(product.image).toEqual([
        'https://lovorithm.vercel.app/cover.jpg',
      ]);
    });

    it('falls back to the brand image when the listing has no cover', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd
          nodes={[
            productJsonLd({ ...PAID_LISTING, coverUrl: null }),
          ]}
        />,
      );
      const [product] = firstBlock(rendered);

      expect(product.image).toEqual([
        'https://lovorithm.vercel.app/og.png',
      ]);
    });

    it('names the creator as the brand and the author', () => {
      const [product] = firstBlock(html);

      expect(product.brand).toEqual({ '@type': 'Brand', name: 'Ada' });
      expect(product.author).toEqual({
        '@type': 'Person',
        name: 'Ada',
        url: 'https://lovorithm.vercel.app/u/ada',
      });
    });

    it('falls back to the handle when the creator has no display name', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd
          nodes={[
            productJsonLd({
              ...PAID_LISTING,
              creator: { handle: 'ada', displayName: null },
            }),
          ]}
        />,
      );
      const [product] = firstBlock(rendered);

      expect(product.brand.name).toBe('@ada');
    });

    it('publishes an Offer with the price, currency, availability and URL', () => {
      const [product] = firstBlock(html);

      expect(product.offers).toEqual({
        '@type': 'Offer',
        price: '18.00',
        priceCurrency: 'HKD',
        availability: 'https://schema.org/InStock',
        url: 'https://lovorithm.vercel.app/l/aaaa3333-0000-0000-0000-000000000002',
      });
    });

    it('prices in the settlement currency, to two decimals', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd
          nodes={[productJsonLd({ ...PAID_LISTING, priceCents: 21835 })]}
        />,
      );
      const [product] = firstBlock(rendered);

      expect(product.offers.price).toBe('218.35');
      expect(product.offers.priceCurrency).toBe('HKD');
    });
  });

  /**
   * The rule that is easiest to get wrong. Google's Offer type lists
   * `price` as REQUIRED, and its merchant-listing guidelines say
   * "merchant listing experiences require a price greater than zero" —
   * a listing page is a purchase page, so it is judged as one. An Offer
   * with a missing price is invalid; an Offer priced 0 is not greater
   * than zero. Both are reported as errors, so a free listing must
   * publish no Offer at all.
   */
  describe('a free listing', () => {
    it('publishes no Offer at all — not one missing a price', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd nodes={[productJsonLd({ ...PAID_LISTING, priceCents: null })]} />,
      );
      const [product] = firstBlock(rendered);

      expect(product.offers).toBeUndefined();
      expect(product['@type']).toBe('Product');
      expect(product.name).toBe('Trivia of our first year');
    });

    it('publishes no Offer for a zero-priced listing either', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd nodes={[productJsonLd({ ...PAID_LISTING, priceCents: 0 })]} />,
      );
      const [product] = firstBlock(rendered);

      expect(product.offers).toBeUndefined();
    });
  });

  describe('breadcrumbs', () => {
    it('publishes an ordered trail from the site root', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd
          nodes={[
            breadcrumbJsonLd([
              { name: 'Lovorithm', url: homeUrl() },
              { name: 'Browse', url: browseUrl() },
              { name: 'Ada', url: profileUrl('ada') },
            ]),
          ]}
        />,
      );
      const [breadcrumb] = firstBlock(rendered);

      expect(breadcrumb['@type']).toBe('BreadcrumbList');
      expect(breadcrumb.itemListElement).toEqual([
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Lovorithm',
          item: 'https://lovorithm.vercel.app/',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Browse',
          item: 'https://lovorithm.vercel.app/browse',
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: 'Ada',
          item: 'https://lovorithm.vercel.app/u/ada',
        },
      ]);
    });
  });

  describe('the site', () => {
    it('publishes the Organization and the WebSite', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd nodes={[organizationJsonLd(), websiteJsonLd()]} />,
      );
      const [organization, website] = firstBlock(rendered);

      expect(organization['@type']).toBe('Organization');
      expect(organization.name).toBe('Lovorithm');
      expect(organization.url).toBe('https://lovorithm.vercel.app');

      expect(website['@type']).toBe('WebSite');
      expect(website.name).toBe('Lovorithm');
      expect(website.url).toBe('https://lovorithm.vercel.app');
      expect(website.publisher).toEqual({
        '@id': 'https://lovorithm.vercel.app/#organization',
      });
    });
  });

  /**
   * A title, a description and a display name are user-authored. An
   * unescaped `</script>` in one of them would close the element early
   * and spill the rest of the JSON into the page as markup.
   */
  describe('user-authored text', () => {
    it('cannot close the script element', () => {
      const rendered = renderToStaticMarkup(
        <JsonLd
          nodes={[
            productJsonLd({
              ...PAID_LISTING,
              title: 'A gift </script><script>alert(1)</script>',
              description: 'Ampersands & <angles> too',
            }),
          ]}
        />,
      );

      expect(rendered).not.toContain('</script><script>alert(1)');
      expect(parseJsonLd(rendered)).toHaveLength(1);

      const [product] = firstBlock(rendered);
      expect(product.name).toBe('A gift </script><script>alert(1)</script>');
      expect(product.description).toBe('Ampersands & <angles> too');
    });
  });

  it('keeps every block it renders valid JSON', () => {
    const rendered = renderToStaticMarkup(
      <JsonLd
        nodes={[
          productJsonLd(PAID_LISTING),
          breadcrumbJsonLd([{ name: 'Lovorithm', url: homeUrl() }]),
          organizationJsonLd(),
          websiteJsonLd(),
        ]}
      />,
    );

    const blocks = parseJsonLd(rendered);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveLength(4);
    for (const node of blocks[0]) {
      expect(node['@context']).toBe('https://schema.org');
    }
  });

  it('builds the canonical URLs the sitemap uses', () => {
    expect(listingUrl('abc')).toBe('https://lovorithm.vercel.app/l/abc');
    expect(profileUrl('ada')).toBe('https://lovorithm.vercel.app/u/ada');
    expect(browseUrl()).toBe('https://lovorithm.vercel.app/browse');
    expect(homeUrl()).toBe('https://lovorithm.vercel.app/');
  });
});
