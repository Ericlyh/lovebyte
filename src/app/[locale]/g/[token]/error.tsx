'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Client error boundary for /g/[token]. Surfaces a typed, recoverable
 * error UI instead of Next.js's default crash page. `reset()` retries
 * the server render — useful for transient Supabase/RLS hiccups.
 *
 * Phase 9 (OOP-4225) — required by acceptance criterion
 * "Every API error path has a typed error UI (not a raw Next.js error page)".
 */
export default function RecipientEnvelopeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('Recipient');

  useEffect(() => {
    // Surface to the browser console so the recipient's bug report
    // (or our own devtools) can pick it up. We deliberately do NOT
    // POST to /api/error-reports here — the share-link surface is
    // anonymous and the digest alone is enough to debug.
    console.error('[/g/[token]] recipient envelope failed:', error);
  }, [error]);

  return (
    <main className="lb-recipient-page">
      <article
        className="lb-recipient lb-recipient--error"
        role="alert"
        aria-labelledby="lb-recipient-error"
      >
        <div className="lb-envelope lb-envelope--muted" aria-hidden="true">💌</div>
        <h1 id="lb-recipient-error">{t('errorTitle')}</h1>
        <p className="lb-recipient__empty-body">{t('errorBody')}</p>
        {error.digest && (
          <p className="lb-recipient__digest">
            <code>{error.digest}</code>
          </p>
        )}
        <div className="lb-cta-row">
          <button
            type="button"
            onClick={reset}
            className="lb-cta-primary lb-recipient__retry"
          >
            {t('errorRetry')}
          </button>
        </div>
      </article>
    </main>
  );
}