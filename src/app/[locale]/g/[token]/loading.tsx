import { getTranslations } from 'next-intl/server';

/**
 * Streaming skeleton for /g/[token] — rendered as the Suspense fallback
 * while `getEnvelopeByToken(token)` resolves. Mirrors the shape of the
 * real envelope card so the swap-in is seamless (no layout shift).
 *
 * Phase 9 (OOP-4225) — was previously blank → user saw an empty page
 * for ~300–800ms while the PostgREST/SELECT ran.
 */
export default async function RecipientEnvelopeLoading() {
  const t = await getTranslations('Recipient');

  return (
    <main className="lb-recipient-page" aria-busy="true" aria-live="polite">
      <article className="lb-recipient lb-skeleton-card" aria-hidden="false">
        <div className="lb-envelope lb-skeleton lb-skeleton--emoji" aria-hidden="true" />
        <div className="lb-skeleton lb-skeleton--h1" aria-hidden="true" />
        <div className="lb-skeleton lb-skeleton--meta" aria-hidden="true" />
        <div className="lb-skeleton lb-skeleton--cover" aria-hidden="true" />
        <div className="lb-cta-row">
          <span className="lb-skeleton lb-skeleton--cta" aria-hidden="true" />
          <span className="lb-skeleton lb-skeleton--cta-secondary" aria-hidden="true" />
        </div>
        <div className="lb-skeleton lb-skeleton--foot" aria-hidden="true" />
        <p className="lb-sr-only">{t('loading')}</p>
      </article>
    </main>
  );
}