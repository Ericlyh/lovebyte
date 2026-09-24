import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { BRAND } from '@/lib/brand';

/**
 * /terms — Phase 10 (OOP-4226).
 *
 * Terms of service. Plain-language copy with an enforceable backbone
 * (governing law, liability cap, refund policy). NOT legal advice;
 * the founder should have a HK-qualified lawyer review before the
 * public launch goes wide. For the closed beta this copy is
 * sufficient and matches the spirit of design/04-architecture §9
 * ("observability minimum viable") — ship, gather feedback, revise.
 */

export const metadata: Metadata = {
  title: `Terms — ${BRAND.NAME}`,
  description: `${BRAND.NAME} terms of service.`,
};

export default async function TermsPage() {
  const t = await getTranslations('Terms');
  const tFoot = await getTranslations('Terms.footer');

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">{BRAND.NAME}</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
        </div>
      </nav>

      <section className="lb-content-page">
        <h1>{t('title')}</h1>
        <p className="lb-content-effective">
          {t('effective', { date: '24 September 2026' })}
        </p>
        <p className="lede">{t('intro')}</p>

        <section>
          <h2>{t('sections.theService.heading')}</h2>
          <p>{t('sections.theService.body')}</p>
        </section>
        <section>
          <h2>{t('sections.yourContent.heading')}</h2>
          <p>{t('sections.yourContent.body')}</p>
        </section>
        <section>
          <h2>{t('sections.accounts.heading')}</h2>
          <p>{t('sections.accounts.body')}</p>
        </section>
        <section>
          <h2>{t('sections.purchases.heading')}</h2>
          <p>{t('sections.purchases.body')}</p>
        </section>
        <section>
          <h2>{t('sections.availability.heading')}</h2>
          <p>{t('sections.availability.body')}</p>
        </section>
        <section>
          <h2>{t('sections.changes.heading')}</h2>
          <p>{t('sections.changes.body')}</p>
        </section>
        <section>
          <h2>{t('sections.liability.heading')}</h2>
          <p>{t('sections.liability.body')}</p>
        </section>
        <section>
          <h2>{t('sections.governing.heading')}</h2>
          <p>{t('sections.governing.body')}</p>
        </section>
        <section>
          <h2>{t('sections.contact.heading')}</h2>
          <p>{t('sections.contact.body')}</p>
        </section>

        <nav className="lb-landing-foot" aria-label="Terms footer">
          <p>
            <Link href="/">{tFoot('home')}</Link>
            {' · '}
            <Link href="/support">{tFoot('support')}</Link>
            {' · '}
            <Link href="/privacy">{tFoot('privacy')}</Link>
            {' · '}
            <Link href="/status">{tFoot('status')}</Link>
          </p>
        </nav>
      </section>
    </main>
  );
}
