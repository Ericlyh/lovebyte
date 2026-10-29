import { animatedLetter } from './animated-letter';
import { anniversary } from './anniversary';
import { birthdayIdeas } from './birthday-ideas';
import { giftIdeasForHer } from './gift-ideas-for-her';
import { giftIdeasForHim } from './gift-ideas-for-him';
import { memoryCards } from './memory-cards';
import { quiz } from './quiz';
import type { GiftPage, GiftPageKind } from './types';

export type { GiftPage, GiftSection, GiftFaq, GiftPageKind, Localized } from './types';
export { localize } from './types';

/**
 * OOP-6727 — every gift guide, in the order they are meant to be read.
 *
 * The order is editorial, not alphabetical: the three format pages
 * come first because they are what the product actually is, then the
 * occasion pages, then the audience pages. The `/gifts` hub groups by
 * this order.
 */
export const GIFT_PAGES: readonly GiftPage[] = [
  memoryCards,
  quiz,
  animatedLetter,
  birthdayIdeas,
  anniversary,
  giftIdeasForHer,
  giftIdeasForHim,
];

/** The guides of one kind, in the registry's order. */
export function giftPagesOfKind(kind: GiftPageKind): GiftPage[] {
  return GIFT_PAGES.filter((page) => page.kind === kind);
}

/** One guide by slug, or null when the slug is not one of ours. */
export function getGiftPage(slug: string): GiftPage | null {
  return GIFT_PAGES.find((page) => page.slug === slug) ?? null;
}
