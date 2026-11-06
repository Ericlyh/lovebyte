'use client';

import { useTranslations } from 'next-intl';
import type { CatalogGift } from '@/lib/catalog';
import { GIFT_KIND_META } from '@/lib/gifts/kinds';
import { GiftCardView } from './GiftCardView';
import { GiftPreviewButton } from './GiftPreviewButton';

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
  const tk = useTranslations('Catalog.kind');
  const creatorLabel = gift.owner.display_name ?? `@${gift.owner.handle}`;
  // OOP-7451 — the kind of gift, e.g. "🎂 Birthday". Null for a listing
  // written before the kind existed.
  const kindLabel = gift.kind
    ? `${GIFT_KIND_META[gift.kind].emoji} ${tk(gift.kind)}`
    : null;

  return (
    <GiftCardView
      gift={gift}
      byText={t('by', { creator: creatorLabel })}
      likesLabel={t('likesLabel', { count: gift.like_count })}
      freeLabel={tp('free')}
      kindLabel={kindLabel}
      headingLevel={headingLevel}
      // OOP-7451 — the preview button sits outside the card's link, so
      // it is its own control and not a nested one.
      action={<GiftPreviewButton gift={gift} />}
    />
  );
}
