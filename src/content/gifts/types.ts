/**
 * OOP-6727 — the shape of a gift guide.
 *
 * A "gift guide" is a page under `/gifts/<slug>` that answers the
 * question someone actually types into a search box — "memory card
 * games", "anniversary gift ideas" — with the specific thing this
 * product does, and the specific limits it really has.
 *
 * The copy lives here, in TypeScript, rather than in the message
 * catalogue, for one reason: a guide is CONTENT, and content that lives
 * in a 800-key JSON bundle shared by every route is exactly the thing
 * the per-route scope slicing (OOP-6726) was built to stop. Chrome
 * strings — the CTA, the FAQ heading, the "related guides" label —
 * stay in the catalogue, where they belong; the prose stays with the
 * page it belongs to.
 *
 * Every string is written twice. A guide that reads well in English and
 * falls back to English in Chinese is a broken page, not a bilingual
 * one, and the product ships in both.
 */

export type Localized = {
  en: string;
  zhHant: string;
};

/** One block of body copy: a heading, a paragraph, and optional points. */
export type GiftSection = {
  heading: Localized;
  body: Localized;
  points?: Localized[];
};

export type GiftFaq = {
  q: Localized;
  a: Localized;
};

/**
 * Which question the page answers. Used to group the `/gifts` hub.
 *
 *   format   — "what can I make?"  (memory cards, quizzes, letters)
 *   occasion — "what do I send for X?" (a birthday, an anniversary)
 *   audience — "what do I send HER / HIM?"
 */
export type GiftPageKind = 'format' | 'occasion' | 'audience';

export type GiftPage = {
  /** The URL segment: `/gifts/<slug>`. */
  slug: string;
  kind: GiftPageKind;
  /** The `<title>` and `<meta name="description">` — no brand suffix. */
  metaTitle: Localized;
  metaDescription: Localized;
  /** The page's own `<h1>`. */
  heading: Localized;
  /** The sentence under the `<h1>`. */
  lede: Localized;
  /** The body of the page. */
  sections: GiftSection[];
  /** Three questions, answered. */
  faq: GiftFaq[];
  /** Slugs of the guides this one links to. */
  related: string[];
};

/**
 * The string for the locale being rendered.
 *
 * The locale comes from the route segment, so this is a pure lookup —
 * no request headers, no cookies. That is what lets a guide be
 * prerendered once per locale.
 */
export function localize(value: Localized, locale: string): string {
  return locale === 'zh-Hant' ? value.zhHant : value.en;
}
