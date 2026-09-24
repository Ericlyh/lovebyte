import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { BRAND } from '@/lib/brand';

/**
 * /support — Phase 10 (OOP-4226).
 *
 * Simple contact page. Three mailto cards (general / bugs / billing)
 * + a "typical response time" line. No live-chat widget for the
 * closed beta (per the issue scope — overkill for our volume).
 *
 * Why mailto and not a contact form? A contact form needs a captcha,
 * a server-side send path, and a way to keep spam out of the inbox.
 * The closed-beta audience is small enough that three mailto links
 * routed to operator-managed inboxes cover the support load; we can
 * graduate to Formspree / Tally if volume warrants it.
 */

export const metadata: Metadata = {
  title: `Support — ${BRAND.NAME}`,
  description: `Get help with ${BRAND.NAME} — contact our small team by email.`,
};

export default async function SupportPage() {
  const t = await getTranslations('Support');
  const tFoot = await getTranslations('Support.footer');

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
        <p className="lede">{t('lede')}</p>

        <article className="lb-support-card">
          <h3>{t('emailHeading')}</h3>
          <p>{t('emailBody')}</p>
          <a href="mailto:support@lovorithm.app">{t('emailCta')}</a>
        </article>

        <article className="lb-support-card">
          <h3>{t('reportHeading')}</h3>
          <p>{t('reportBody')}</p>
          <a href="mailto:bugs@lovorithm.app">{t('reportCta')}</a>
        </article>

        <article className="lb-support-card">
          <h3>{t('billingHeading')}</h3>
          <p>{t('billingBody')}</p>
          <a href="mailto:billing@lovorithm.app">{t('billingCta')}</a>
        </article>

        <p style={{ color: 'var(--lb-ink-soft)', fontSize: 13, marginTop: 24 }}>
          {t('responseTime')}
        </p>

        <nav className="lb-landing-foot" aria-label="Support footer">
          <p>
            <Link href="/">{tFoot('home')}</Link>
            {' · '}
            <Link href="/status">{tFoot('status')}</Link>
            {' · '}
            <Link href="/privacy">{tFoot('privacy')}</Link>
            {' · '}
            <Link href="/terms">{tFoot('terms')}</Link>
          </p>
        </nav>
      </section>
    </main>
  );
}
