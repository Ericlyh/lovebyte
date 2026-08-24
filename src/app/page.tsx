import { getTranslations } from 'next-intl/server';

/**
 * Phase 1 placeholder landing page.
 *
 * Phase 2 (per design/04-architecture/architecture.md §12) replaces this
 * with the full landing mockup (design/03-mockups/landing.html). For now
 * we render a minimal scaffold-ready screen that proves the warm-romantic
 * palette is wired through Tailwind utilities (`bg-lb-blush`, `text-lb-primary`,
 * `font-lb-display`) and that next-intl is resolving the right message bundle.
 */
export default async function Home() {
  const t = await getTranslations('Scaffold');

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <div className="lb-nav__brand">{t('brand')}</div>
        <div className="lb-nav__links">
          <span className="lb-tag">{t('phase')}</span>
        </div>
      </nav>

      <section className="lb-hero flex-1 flex flex-col items-center justify-center px-6">
        <span className="lb-tag">Made in Hong Kong · 為香港而設</span>
        <h1 className="mt-6 font-lb-display text-lb-primary">
          {t('title')}
        </h1>
        <p className="mt-4 max-w-xl text-center text-lb-ink-soft">
          {t('subtitle')}
        </p>

        <div className="mt-12 lb-card max-w-md w-full">
          <p className="text-sm font-semibold text-lb-ink-soft uppercase tracking-wider">
            {t('checklist_heading')}
          </p>
          <ul className="mt-4 space-y-2 text-sm text-lb-ink">
            <li>✓ Next.js {`16`} (App Router) + Tailwind {`4`}</li>
            <li>✓ Warm-romantic palette via shared-tokens.css</li>
            <li>✓ next-intl middleware (EN + 繁中, localePrefix=never)</li>
            <li>✓ @supabase/ssr client + server scaffolds</li>
            <li>✓ Supabase schema migration (profiles, gifts, shares, …)</li>
            <li>· Vercel deploy — blocked on credentials</li>
            <li>· Supabase Cloud project — blocked on credentials</li>
          </ul>
        </div>
      </section>

      <footer className="lb-landing-foot">
        {t('footer')}
      </footer>
    </main>
  );
}
