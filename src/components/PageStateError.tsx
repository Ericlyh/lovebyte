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
  /**
   * The copy, for a boundary that has no intl provider.
   *
   * `src/app/global-error.tsx` REPLACES the root layout — that is what a
   * global error boundary does — so there is no `NextIntlClientProvider`
   * above it and `useTranslations` has no context to read. It also must
   * not depend on the message catalogue: the failure it catches may BE
   * the catalogue failing to load.
   */
  copy?: { title: string; body: string; retry: string };
};

export default function PageStateError({ error, reset, icon = '⚠️', copy }: Props) {
  // Two components rather than one conditional hook: the translated card
  // calls `useTranslations`, and the untranslated one must not.
  if (copy) {
    return <ErrorCard error={error} reset={reset} icon={icon} copy={copy} />;
  }
  return <TranslatedErrorCard error={error} reset={reset} icon={icon} />;
}

function TranslatedErrorCard({
  error,
  reset,
  icon,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  icon: string;
}) {
  const t = useTranslations('Common.error');

  return (
    <ErrorCard
      error={error}
      reset={reset}
      icon={icon}
      copy={{ title: t('title'), body: t('body'), retry: t('retry') }}
    />
  );
}

function ErrorCard({
  error,
  reset,
  icon,
  copy,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  icon: string;
  copy: { title: string; body: string; retry: string };
}) {
  useEffect(() => {
    console.error('[page error boundary]', error);
  }, [error]);

  return (
    <div className="lb-empty-card" role="alert">
      <div className="lb-empty-card__icon" aria-hidden="true">
        {icon}
      </div>
      <h2 className="lb-empty-card__title">{copy.title}</h2>
      <p className="lb-empty-card__body">{copy.body}</p>
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
          {copy.retry}
        </button>
      </div>
    </div>
  );
}