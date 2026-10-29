'use client';

import { useTranslations } from 'next-intl';
import type { CatalogGift } from '@/lib/catalog';
import { GiftCardView } from './GiftCardView';

/**
 * Gift card for the client-fetched /browse grid (OOP-6710).
 *
 * The /browse grid is fetched in the browser — a prerendered page cannot
 * hold a live catalog, and the catalog is empty at build time anyway — so
 * its cards are client components. The markup is the same `GiftCardView`
 * the server-rendered `/u/[handle]` grid uses; only the label lookup
 * differs (`useTranslations` instead of `getTranslations`).
 */
type Props = {
  gift: CatalogGift;
  /**
   * The heading level the card title is rendered at (OOP-6738). The
   * /browse grid passes `h2`: the cards are the top-level content of
   * the page, under its `h1`.
   */
  headingLevel: 'h2' | 'h3';
};

export function GiftCardClient({ gift, headingLevel }: Props) {
  const t = useTranslations('Catalog.card');
  const tp = useTranslations('Catalog.price');
  const creatorLabel = gift.owner.display_name ?? `@${gift.owner.handle}`;

  return (
    <GiftCardView
      gift={gift}
      byText={t('by', { creator: creatorLabel })}
      likesLabel={t('likesLabel', { count: gift.like_count })}
      freeLabel={tp('free')}
      headingLevel={headingLevel}
    />
  );
}
