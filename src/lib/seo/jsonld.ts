import { BRAND } from '@/lib/brand';
import { SETTLEMENT_CURRENCY_DB } from '@/lib/money';
import { GIFT_TYPES } from '@/lib/gifts/types';
import { canonicalUrl } from './metadata';

/**
 * Structured data (JSON-LD) for the public pages (OOP-6728).
 *
 * Before this module the site emitted NO structured data at all: a
 * listing had a price, a currency and a creator in the DOM, and Google
 * was told none of it. For a marketplace the listing IS the product, so
 * without a `Product` there is no price, no availability and no way to
 * qualify for a merchant / product rich result.
 *
 * ## Why the builders live in their own module
 *
 * They are pure functions over plain data — no Supabase, no React, no
 * `next-intl`. That keeps them testable (the test parses the JSON out
 * of rendered HTML) and keeps the pages thin: a page reads its data,
 * hands it to a builder, and renders the result.
 *
 * ## Why each node carries its own `@context`
 *
 * Every `<script type="application/ld+json">` holds an ARRAY of nodes
 * (see `JsonLd.tsx`). A JSON-LD document may be an array at the top
 * level, and when it is, each node has to state its own context — there
 * is no single enclosing object to carry it.
 *
 * ## The free-listing rule (the one that is easy to get wrong)
 *
 * A gift with `price_cents = null` is free. Google's Offer type lists
 * `price` as a REQUIRED property, and the merchant-listing guidelines
 * say plainly:
 *
 *     "Unlike product snippets, merchant listing experiences require a
 *      price greater than zero."
 *
 * A listing page is a purchase page (it has a "send this gift" CTA into
 * the checkout), so it is judged as a merchant listing. An Offer with a
 * missing price is an invalid Offer; an Offer with price 0 is a price
 * that is not greater than zero. Both are errors in the Merchant
 * listings report, and a wrong rich result is worse than none.
 *
 * So a free listing emits a `Product` with NO `offers` key at all. The
 * Product itself stays valid — `offers` is a recommended, not required,
 * property of `Product` — and nothing invalid is published.
 *
 * ## What is deliberately NOT here
 *
 *   • `aggregateRating` from `like_count`. A like is not a rating;
 *     publishing one as a star score is fabricated review markup and
 *     earns a manual action. The comment count is not a rating either.
 *   • A `Review` node. There are no written reviews to publish.
 */
export const JSON_LD_CONTEXT = 'https://schema.org';

/** A single JSON-LD node. Schema.org nodes are open-ended maps. */
export type JsonLdNode = Record<string, unknown>;

/**
 * The brand image, used when a listing has no cover of its own.
 *
 * A gift with no photo (a quiz, a code gift) still needs an `image` —
 * Google treats it as a recommended property of `Product`, and the
 * listing card shows a category tile in the same place. The brand's
 * social card is the honest stand-in: it is the image this page
 * already presents to the world.
 */
const DEFAULT_IMAGE_URL = `${BRAND.PRODUCTION_URL}/og.png`;

/** Every listed gift is purchasable, so every one of them is in stock. */
const AVAILABILITY_IN_STOCK = 'https://schema.org/InStock';

/**
 * Human label per gift category.
 *
 * The labels come from the gift-type catalogue (`GIFT_TYPES`), which is
 * the single source of truth for what a gift format is called — the
 * same map the creator's format picker renders.
 */
const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  GIFT_TYPES.map((giftType) => [giftType.value, giftType.label]),
);

// ─── Canonical URLs ────────────────────────────────────────────────────────
//
// The proxy rewrites the locale in and out of the URL, so the public
// form of a page carries no locale prefix.
//
// These are thin wrappers over `canonicalUrl` (OOP-6727), which is the
// repo's one spelling of a public page's address — the same one the
// `<link rel="canonical">` tags and the sitemap use. One URL per page,
// spelled once: a page that advertises two different canonical URLs
// splits its own ranking between them.

/** The site root. */
export function homeUrl(): string {
  return canonicalUrl('/');
}

/** The public catalogue. */
export function browseUrl(): string {
  return canonicalUrl('/browse');
}

/** One listing — the canonical URL of a gift's public page. */
export function listingUrl(giftId: string): string {
  return canonicalUrl(`/l/${giftId}`);
}

/** One creator's public storefront. */
export function profileUrl(handle: string): string {
  return canonicalUrl(`/u/${handle}`);
}

// ─── Product ───────────────────────────────────────────────────────────────

export type ProductJsonLdInput = {
  /** The gift's id — the last path segment of its canonical URL. */
  id: string;
  title: string;
  description: string | null;
  /** The gift's category (`memory_cards`, `quiz`, …) or null. */
  category: string | null;
  /** The asking price in settlement cents; null means the gift is free. */
  priceCents: number | null;
  /** Absolute URL of the listing's cover photo, or null when it has none. */
  coverUrl: string | null;
  /** The creator who owns the listing. */
  creator: { handle: string; displayName: string | null };
};

/**
 * The `Product` node for one listing.
 *
 * `offers` is present only when the gift has a real price — see the
 * free-listing rule at the top of this file.
 */
export function productJsonLd(input: ProductJsonLdInput): JsonLdNode {
  const url = listingUrl(input.id);
  const creatorName = input.creator.displayName ?? `@${input.creator.handle}`;

  const node: JsonLdNode = {
    '@context': JSON_LD_CONTEXT,
    '@type': 'Product',
    name: input.title,
    // A listing with no description still needs one — the title is an
    // honest description of what the gift is.
    description: input.description ?? input.title,
    image: [input.coverUrl ?? DEFAULT_IMAGE_URL],
    url,
    // The creator is the brand of the gift: it is their work, sold
    // under their name. `brand` is what Google puts next to the title.
    brand: { '@type': 'Brand', name: creatorName },
    author: {
      '@type': 'Person',
      name: creatorName,
      url: profileUrl(input.creator.handle),
    },
  };

  const category = input.category
    ? (CATEGORY_LABELS[input.category] ?? input.category)
    : null;
  if (category) node.category = category;

  const offer = offerJsonLd(input.priceCents, url);
  if (offer) node.offers = offer;

  return node;
}

/**
 * The `Offer` node for a paid listing, or null for a free one.
 *
 * A gift priced at zero is free, not a zero-priced offer: Google's
 * merchant listing guidelines require a price greater than zero, so a
 * zero offer would be reported as an error. Returning null here is what
 * makes the listing's `Product` omit `offers` entirely.
 */
function offerJsonLd(priceCents: number | null, url: string): JsonLdNode | null {
  if (priceCents === null || priceCents <= 0) return null;

  return {
    '@type': 'Offer',
    // A string with two decimals: it is the exact amount, with no
    // float rounding and no trailing zero lost on the way out.
    price: (priceCents / 100).toFixed(2),
    // ISO 4217, upper case — `HKD`. The catalogue settles in one
    // currency (see `src/lib/money.ts`).
    priceCurrency: SETTLEMENT_CURRENCY_DB,
    availability: AVAILABILITY_IN_STOCK,
    url,
  };
}

// ─── Breadcrumbs ───────────────────────────────────────────────────────────

export type BreadcrumbItem = {
  /** The label a reader sees. */
  name: string;
  /** The page the crumb points at. */
  url?: string;
};

/**
 * A `BreadcrumbList` — the trail from the site root down to the page.
 *
 * `position` is 1-based and must be contiguous; Google reads the list
 * as an ordered trail, not a set of links.
 */
export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLdNode {
  return {
    '@context': JSON_LD_CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}

// ─── Site ──────────────────────────────────────────────────────────────────

/**
 * The `Organization` node — one per site, published by the root layout.
 *
 * The `@id` is what lets the `WebSite` node point at it without
 * repeating the whole organization.
 */
export function organizationJsonLd(): JsonLdNode {
  return {
    '@context': JSON_LD_CONTEXT,
    '@type': 'Organization',
    '@id': `${BRAND.PRODUCTION_URL}/#organization`,
    name: BRAND.NAME,
    url: BRAND.PRODUCTION_URL,
    description: BRAND.TAGLINE,
    logo: DEFAULT_IMAGE_URL,
  };
}

/**
 * The `WebSite` node — one per site, published by the root layout.
 */
export function websiteJsonLd(): JsonLdNode {
  return {
    '@context': JSON_LD_CONTEXT,
    '@type': 'WebSite',
    '@id': `${BRAND.PRODUCTION_URL}/#website`,
    name: BRAND.NAME,
    url: BRAND.PRODUCTION_URL,
    description: BRAND.TAGLINE,
    publisher: { '@id': `${BRAND.PRODUCTION_URL}/#organization` },
  };
}

// ─── Serialisation ────────────────────────────────────────────────────────

/**
 * Serialise nodes for a `<script type="application/ld+json">` element.
 *
 * `<`, `>` and `&` are escaped to their `\uXXXX` forms. A title, a
 * description or a creator's display name is user-authored text, and
 * an unescaped `</script>` inside one would close the element early —
 * the rest of the JSON would land in the page as markup. Escaping them
 * keeps the JSON-LD a single well-formed element whatever a user types.
 * `JSON.parse` turns them back into the original characters.
 */
export function serializeJsonLd(nodes: JsonLdNode[]): string {
  return JSON.stringify(nodes).replace(
    /[<>&]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
