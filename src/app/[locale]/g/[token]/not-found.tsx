import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

/**
 * Renders when `getEnvelopeByToken(token)` returns null. Replaces the
 * default Next.js 404 page on the public share-link surface.
 *
 * Phase 9 (OOP-4225) — the page called `notFound()` previously fell
 * through to Next.js's bare 404, which broke the "polished public beta
 * link share" goal.
 */
export default async function RecipientEnvelopeNotFound() {
  const t = await getTranslations('Recipient');

  return (
    <main className="lb-recipient-page">
      <article className="lb-recipient lb-recipient--empty" aria-labelledby="lb-recipient-notfound">
        <div className="lb-envelope lb-envelope--muted" aria-hidden="true">💌</div>
        <h1 id="lb-recipient-notfound">{t('notFoundTitle')}</h1>
        <p className="lb-recipient__empty-body">{t('notFoundBody')}</p>
        <div className="lb-cta-row">
          <Link href="/" className="lb-cta-primary">
            {t('notFoundCta')}
          </Link>
        </div>
      </article>
    </main>
  );
}