'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  republishGiftAction,
  unpublishGiftAction,
  type ListingActionResult,
} from '@/lib/actions/listing';

/**
 * The owner's per-listing controls (OOP-6719).
 *
 * A creator who cannot take down a listing will stop creating. This is
 * the button that lets them: "Unpublish" pulls the listing off the
 * marketplace (it disappears from /browse and the sitemap immediately),
 * and "Republish" puts it back.
 *
 * The action is reversible and nothing is destroyed — the row is
 * soft-deleted, the share links still work for the people who bought it,
 * and the sales history is untouched — but it does change what the public
 * sees, so it asks first.
 *
 * The server action is the authority on ownership (RLS `gifts_update_own`
 * refuses a write to a gift the caller does not own); this component only
 * reports success or failure. On success it calls `router.refresh()`,
 * which re-renders the server component tree and brings the profile back
 * in line with the database.
 */
type Props = {
  giftId: string;
  /**
   * What the button does.
   *
   *   'unpublish' — the listing is live; take it off the marketplace.
   *   'republish'  — the listing is soft-deleted; put it back.
   *   null         — the gift is a draft that was never listed, so there
   *                  is nothing on the marketplace to take down.
   */
  mode: 'unpublish' | 'republish' | null;
};

export function OwnedGiftActions({ giftId, mode }: Props) {
  const t = useTranslations('Profile.listing');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!mode) return null;

  function run(action: 'unpublish' | 'republish') {
    if (isPending) return;

    const question =
      action === 'unpublish' ? t('confirmUnpublish') : t('confirmRepublish');
    if (typeof window !== 'undefined' && !window.confirm(question)) return;

    setError(null);
    startTransition(async () => {
      const res: ListingActionResult =
        action === 'unpublish'
          ? await unpublishGiftAction({ giftId })
          : await republishGiftAction({ giftId });

      if (!res.ok) {
        // The server message is in English and the page may not be, so
        // it goes to the log rather than the screen; the reader gets
        // the localised line.
        console.error('[OwnedGiftActions]', action, res.error);
        setError(t('error'));
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="lb-owned-gift__actions">
      {mode === 'republish' ? (
        <button
          type="button"
          className="lb-btn lb-btn--sm lb-btn--primary"
          onClick={() => run('republish')}
          disabled={isPending}
        >
          {isPending ? t('working') : t('republish')}
        </button>
      ) : (
        <button
          type="button"
          className="lb-btn lb-btn--sm lb-btn--ghost"
          onClick={() => run('unpublish')}
          disabled={isPending}
        >
          {isPending ? t('working') : t('unpublish')}
        </button>
      )}
      {error ? <span className="lb-owned-gift__error">{error}</span> : null}
    </div>
  );
}
