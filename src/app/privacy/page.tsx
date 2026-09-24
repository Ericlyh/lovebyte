import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { BRAND } from '@/lib/brand';

/**
 * /privacy — Phase 10 (OOP-4226).
 *
 * Privacy policy page. Rendered as a server component so the page is
 * fully static and ships the same content to every visitor. The
 * effective date is set in the i18n bundle (one string per locale)
 * so the marketing / legal owner can bump it without a deploy.
 */

export const metadata: Metadata = {
  title: `Privacy — ${BRAND.NAME}`,
  description: `${BRAND.NAME} privacy policy: what we collect, how we use it, and your choices.`,
};

export default async function PrivacyPage() {
  const t = await getTranslations('Privacy');
  const tFoot = await getTranslations('Privacy.footer');

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
          <h2>{t('sections.whatWeCollect.heading')}</h2>
          <p>{t('sections.whatWeCollect.body')}</p>
        </section>
        <section>
          <h2>{t('sections.howWeUse.heading')}</h2>
          <p>{t('sections.howWeUse.body')}</p>
        </section>
        <section>
          <h2>{t('sections.storage.heading')}</h2>
          <p>{t('sections.storage.body')}</p>
        </section>
        <section>
          <h2>{t('sections.sharing.heading')}</h2>
          <p>{t('sections.sharing.body')}</p>
        </section>
        <section>
          <h2>{t('sections.yourChoices.heading')}</h2>
          <p>{t('sections.yourChoices.body')}</p>
        </section>
        <section>
          <h2>{t('sections.cookies.heading')}</h2>
          <p>{t('sections.cookies.body')}</p>
        </section>
        <section>
          <h2>{t('sections.contact.heading')}</h2>
          <p>{t('sections.contact.body')}</p>
        </section>

        <nav className="lb-landing-foot" aria-label="Privacy footer">
          <p>
            <Link href="/">{tFoot('home')}</Link>
            {' · '}
            <Link href="/support">{tFoot('support')}</Link>
            {' · '}
            <Link href="/terms">{tFoot('terms')}</Link>
            {' · '}
            <Link href="/status">{tFoot('status')}</Link>
          </p>
        </nav>
      </section>
    </main>
  );
}
