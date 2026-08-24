import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LanguageToggle } from '@/components/LanguageToggle';

/**
 * Landing page — Phase 2 (architecture.md §12).
 *
 * Ported from design/03-mockups/landing.html to a Next.js 16 App Router
 * server component. All copy is sourced from the `Landing` namespace so
 * the EN ↔ 繁中 switch via the <LanguageToggle /> re-renders the page
 * with the matching message bundle.
 */
export default async function Home() {
  const t = await getTranslations('Landing');

  const features = [
    { id: 'cards', emoji: '🎴' },
    { id: 'puzzle', emoji: '🧩' },
    { id: 'quiz', emoji: '💬' },
    { id: 'collage', emoji: '🎞️' },
    { id: 'letter', emoji: '💌' },
  ] as const;

  const steps = [1, 2, 3] as const;

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">{t('brand')}</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
          <Link href="/login">{t('nav.signin')}</Link>
          <Link href="/signup" className="lb-btn lb-btn--primary lb-btn--sm">
            {t('nav.startFree')}
          </Link>
        </div>
      </nav>

      <section className="lb-landing-hero">
        <span className="lb-tag">{t('hero.tag')}</span>
        <h1>
          {t('hero.line1')}
          <br />
          {t('hero.line2')}
        </h1>
        <p className="lede">{t('hero.lede')}</p>
        <div className="lb-landing-cta-row">
          <Link href="/create" className="lb-btn lb-btn--primary">
            {t('hero.ctaPrimary')}
          </Link>
          <Link href="/g/demo" className="lb-btn lb-btn--ghost">
            {t('hero.ctaSecondary')}
          </Link>
        </div>
      </section>

      <section className="lb-features" aria-label={t('features.heading')}>
        {features.map((f) => (
          <article key={f.id} className="lb-feature">
            <div className="lb-feature__emoji" aria-hidden="true">{f.emoji}</div>
            <h3>{t(`features.${f.id}.title`)}</h3>
            <p>{t(`features.${f.id}.body`)}</p>
          </article>
        ))}
      </section>

      <section className="lb-how-it-works" aria-label={t('how.heading')}>
        <h2>{t('how.title')}</h2>
        <div className="lb-steps">
          {steps.map((n) => (
            <article key={n} className="lb-step">
              <div className="lb-step__num" aria-hidden="true">{n}</div>
              <h4>{t(`how.steps.${n}.title`)}</h4>
              <p>{t(`how.steps.${n}.body`)}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="lb-landing-foot">
        <p>
          {t('footer.line')}{' '}
          <a href="#">{t('footer.privacy')}</a>{' · '}
          <a href="#">{t('footer.terms')}</a>
        </p>
      </footer>
    </main>
  );
}
