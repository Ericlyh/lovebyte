'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Client-side error boundary card. Wraps `<PageState>` so the
 * `reset()` retry button works (server components can't call it).
 *
 * Phase 9 (OOP-4225) — sibling of `PageState.tsx` for routes that
 * need a typed error UI. Logs the digest to console for the bug
 * reporter / devtools. Deliberately does not POST to /api/error-
 * reports: the share-link + browse surfaces are anonymous and the
 * digest alone is enough to debug.
 */
type Props = {
  error: Error & { digest?: string };
  reset: () => void;
  icon?: string;
};

export default function PageStateError({ error, reset, icon = '⚠️' }: Props) {
  const t = useTranslations('Common.error');

  useEffect(() => {
    console.error('[page error boundary]', error);
  }, [error]);

  return (
    <div className="lb-empty-card" role="alert">
      <div className="lb-empty-card__icon" aria-hidden="true">
        {icon}
      </div>
      <h2 className="lb-empty-card__title">{t('title')}</h2>
      <p className="lb-empty-card__body">{t('body')}</p>
      {error.digest && (
        <p className="lb-empty-card__body" style={{ fontSize: 12, opacity: 0.6 }}>
          <code>{error.digest}</code>
        </p>
      )}
      <div className="lb-empty-card__actions">
        <button
          type="button"
          onClick={reset}
          className="lb-btn lb-btn--primary"
        >
          {t('retry')}
        </button>
      </div>
    </div>
  );
}