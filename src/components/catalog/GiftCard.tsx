import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { CatalogGift } from '@/lib/catalog';
import { PriceBadge } from './PriceBadge';

/**
 * Gift card for the /browse grid (M-C, OOP-4275).
 *
 * Server component — no client JS. Cover is a category-tinted tile
 * (placeholder gradient; cover image arrives in M-F when gift_media
 * is fully wired). Title + creator handle + price + like count.
 *
 * Like count is rendered as a small inline badge. We deliberately
 * don't show the like BUTTON on /browse cards — M-C's acceptance test
 * covers the like button on /l/[giftId] only. Showing count without
 * a button keeps the grid scannable.
 */
type Props = {
  gift: CatalogGift;
};

const CATEGORY_EMOJI: Record<string, string> = {
  memory_cards: '🂡',
  dragdrop_puzzle: '🧩',
  quiz: '❓',
  multimedia_collage: '🖼️',
  animated_letter: '✉️',
};

export async function GiftCard({ gift }: Props) {
  const t = await getTranslations('Catalog.card');
  const emoji = gift.category ? CATEGORY_EMOJI[gift.category] ?? '🎁' : '🎁';
  const creatorLabel = gift.owner.display_name ?? `@${gift.owner.handle}`;

  return (
    <Link href={`/l/${gift.id}`} className="lb-gift-card">
      <div className="lb-gift-card__cover" data-category={gift.category ?? 'unknown'}>
        <span className="lb-gift-card__emoji" aria-hidden="true">
          {emoji}
        </span>
      </div>
      <div className="lb-gift-card__body">
        <h3 className="lb-gift-card__title">{gift.title}</h3>
        <p className="lb-gift-card__creator">
          {t('by', { creator: creatorLabel })}
        </p>
        <div className="lb-gift-card__meta">
          <PriceBadge priceCents={gift.price_cents} currency={gift.currency} />
          <span className="lb-gift-card__likes" aria-label={t('likesLabel')}>
            ♥ {gift.like_count}
          </span>
        </div>
      </div>
    </Link>
  );
}
