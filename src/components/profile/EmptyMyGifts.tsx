import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * Empty state for the owner's "My Gifts (use)" tab on /u/[handle]
 * (OOP-5685).
 *
 * Shown only when the viewer is the owner and they haven't created any
 * gifts yet (drafts OR published). One primary CTA — "Create a gift" →
 * the gift-type picker — keeps the empty card focused. The
 * "For Sale" tab on the same page uses `EmptyCollectionState` instead
 * because it has a different tone ("you haven't listed yet" vs.
 * "you haven't built yet").
 *
 * Server component, no client JS.
 */
export async function EmptyMyGifts() {
  const t = await getTranslations('Profile.emptyMyGifts');
  return (
    <div className="lb-empty-card" role="status">
      <div className="lb-empty-card__icon" aria-hidden="true">
        ✏️
      </div>
      <h3 className="lb-empty-card__title">{t('title')}</h3>
      <p className="lb-empty-card__body">{t('body')}</p>
      <div className="lb-empty-card__actions">
        <Link href="/create" className="lb-btn lb-btn--primary">
          {t('cta')}
        </Link>
      </div>
    </div>
  );
}