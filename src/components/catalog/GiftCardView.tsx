import Link from 'next/link';
import type { CatalogGift } from '@/lib/catalog';
import { PriceBadgeView } from './PriceBadgeView';

/**
 * Gift card markup for the /browse grid (M-C, OOP-4275).
 *
 * Pure presentation — every label is passed in already resolved, so this
 * one component serves both the server card (`GiftCard`) and the client
 * card (`GiftCardClient`). The /browse grid is fetched on the client
 * (OOP-6710), while `/u/[handle]` still renders cards on the server, so
 * the markup lives here rather than in either wrapper.
 *
 * Cover is the listing's cover photo when it has one (OOP-6717), and a
 * category-tinted tile otherwise. Title + creator handle + price + like
 * count.
 *
 * Like count is rendered as a small inline badge. We deliberately don't
 * show the like BUTTON on /browse cards — M-C's acceptance test covers the
 * like button on /l/[giftId] only. Showing count without a button keeps the
 * grid scannable.
 */
type Props = {
  gift: CatalogGift;
  /** "by <creator>", already interpolated. */
  byText: string;
  /** Screen-reader label for the like count, already interpolated. */
  likesLabel: string;
  /** Resolved "Free" label for the price badge. */
  freeLabel: string;
  /**
   * Where the card links to. Defaults to the listing's detail page.
   * Pass `null` for a listing with no public page — an unpublished
   * listing renders as a plain tile rather than a link to a 404
   * (OOP-6719).
   */
  href?: string | null;
};

const CATEGORY_EMOJI: Record<string, string> = {
  memory_cards: '🂡',
  dragdrop_puzzle: '🧩',
  quiz: '❓',
  multimedia_collage: '🖼️',
  animated_letter: '✉️',
  code: '💻',
};

export function GiftCardView({ gift, byText, likesLabel, freeLabel, href }: Props) {
  const emoji = gift.category ? CATEGORY_EMOJI[gift.category] ?? '🎁' : '🎁';

  const target = href === undefined ? `/l/${gift.id}` : href;

  const body = (
    <>
      <div className="lb-gift-card__cover" data-category={gift.category ?? 'unknown'}>
        {gift.cover_url ? (
          // Decorative: the title sits right below it, so the image
          // carries no alt text of its own.
          <img
            src={gift.cover_url}
            alt=""
            className="lb-gift-card__img"
            loading="lazy"
          />
        ) : (
          <span className="lb-gift-card__emoji" aria-hidden="true">
            {emoji}
          </span>
        )}
      </div>
      <div className="lb-gift-card__body">
        <h3 className="lb-gift-card__title">{gift.title}</h3>
        <p className="lb-gift-card__creator">{byText}</p>
        <div className="lb-gift-card__meta">
          <PriceBadgeView priceCents={gift.price_cents} freeLabel={freeLabel} />
          <span className="lb-gift-card__likes" aria-label={likesLabel}>
            ♥ {gift.like_count}
          </span>
        </div>
      </div>
    </>
  );

  // An unpublished listing has no public detail page, so the card
  // renders as a plain tile rather than a link to a 404 (OOP-6719).
  if (!target) {
    return <div className="lb-gift-card">{body}</div>;
  }

  return (
    <Link href={target} className="lb-gift-card">
      {body}
    </Link>
  );
}
