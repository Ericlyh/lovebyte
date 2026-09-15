import { getTranslations } from 'next-intl/server';
import type { GiftCategory } from '@/lib/catalog';

/**
 * Inline preview of the gift payload for /l/[giftId] (M-C, OOP-4275).
 *
 * M-C ships a static preview card — we don't embed a live `/g/[token]`
 * iframe yet because (a) no `shares` row exists for the gift until the
 * creator hits "Publish" in M-F, and (b) the live envelope is a heavy
 * page that would feel out of place above the fold.
 *
 * The preview is intentionally simple — title + first 140 chars of the
 * description + a category-specific accent. M-F can swap it for the
 * iframe when share rows exist.
 */
type Props = {
  title: string;
  description: string | null;
  category: GiftCategory | null;
};

const CATEGORY_LABEL: Record<GiftCategory, string> = {
  memory_cards: 'Memory cards',
  dragdrop_puzzle: 'Photo puzzle',
  quiz: 'Quiz',
  multimedia_collage: 'Collage',
  animated_letter: 'Animated letter',
};

export async function ListingPreview({ title, description, category }: Props) {
  const t = await getTranslations('Catalog.preview');
  const snippet = description ? description.slice(0, 140) : '';

  return (
    <aside className="lb-listing-preview" data-category={category ?? 'unknown'}>
      <p className="lb-listing-preview__tag">
        {category ? CATEGORY_LABEL[category] : t('tag')}
      </p>
      <h2 className="lb-listing-preview__title">{title}</h2>
      {snippet ? <p className="lb-listing-preview__snippet">{snippet}…</p> : null}
    </aside>
  );
}
