import { getTranslations } from 'next-intl/server';
import type { CatalogGift } from '@/lib/catalog';
import { GiftCardView } from './GiftCardView';

/**
 * Gift card for the server-rendered grids (M-C, OOP-4275).
 *
 * Server component — no client JS. Used by `/u/[handle]`, which renders
 * the owner's gifts on the server. The /browse grid uses `GiftCardClient`
 * instead, because that grid is fetched in the browser (OOP-6710).
 *
 * The markup itself lives in `GiftCardView` so both cards stay identical.
 */
type Props = {
  gift: CatalogGift;
};

export async function GiftCard({ gift }: Props) {
  const t = await getTranslations('Catalog.card');
  const tp = await getTranslations('Catalog.price');
  const creatorLabel = gift.owner.display_name ?? `@${gift.owner.handle}`;

  return (
    <GiftCardView
      gift={gift}
      byText={t('by', { creator: creatorLabel })}
      likesLabel={t('likesLabel', { count: gift.like_count })}
      freeLabel={tp('free')}
    />
  );
}
