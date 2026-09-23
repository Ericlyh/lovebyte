import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * Empty state for /u/[handle] when the creator has zero listed gifts
 * (OOP-4225 Phase 9 polish).
 *
 * Two flavours — same geometry, different copy + CTA set:
 *   - viewerIsOwner  → primary "List a gift" (→ /create), secondary
 *                      "Browse the marketplace" (→ /browse). The page
 *                      already shows the user is signed in via the
 *                      Nav, so we don't gate on auth here.
 *   - viewerIsAnon   → primary "Browse the marketplace" (→ /browse)
 *                      only. No "follow" CTA: the FollowButton is
 *                      already in the hero section above.
 *
 * Server component. No client JS — the CTAs are plain <Link>s. The
 * geometry is shared with /g/[token]/not-found so an empty collection
 * feels like a deliberate pause, not a missing page.
 */
type Props = {
  viewerIsOwner: boolean;
  handle: string;
};

export async function EmptyCollectionState({ viewerIsOwner, handle }: Props) {
  const t = await getTranslations('Profile.emptyCollectionCard');

  return (
    <div className="lb-empty-card" role="status">
      <div className="lb-empty-card__icon" aria-hidden="true">
        {viewerIsOwner ? '🎁' : '✨'}
      </div>
      <h3 className="lb-empty-card__title">
        {viewerIsOwner ? t('ownerTitle') : t('anonTitle')}
      </h3>
      <p className="lb-empty-card__body">
        {viewerIsOwner
          ? t('ownerBody')
          : t('anonBody', { handle })}
      </p>
      <div className="lb-empty-card__actions">
        {viewerIsOwner ? (
          <>
            <Link href="/create" className="lb-btn lb-btn--primary">
              {t('ownerCtaPrimary')}
            </Link>
            <Link href="/browse" className="lb-btn lb-btn--ghost">
              {t('ownerCtaSecondary')}
            </Link>
          </>
        ) : (
          <Link href="/browse" className="lb-btn lb-btn--primary">
            {t('anonCtaPrimary')}
          </Link>
        )}
      </div>
    </div>
  );
}
