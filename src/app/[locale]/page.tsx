import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { GiftCard } from '@/components/catalog/GiftCard';
import { WaitlistForm } from '@/components/WaitlistForm';
import { getCatalogFeed } from '@/lib/catalog';
import { turnstileEnabled } from '@/lib/turnstile';

/**
 * OOP-6712 — how many live listings the landing page previews.
 *
 * Six is what fits the 3-up grid in two rows without pushing the rest
 * of the page too far down.
 */
const CATALOGUE_PREVIEW_COUNT = 6;

/**
 * OOP-6712 — the catalogue preview is live data, but the landing page is
 * prerendered once per locale (OOP-6710), so it cannot be re-rendered on
 * every request. ISR re-renders it every 5 minutes instead: the page
 * stays static (and therefore fast to serve), and a listing that appears
 * or changes price shows up within that window. The feed is read with the
 * cookie-free public client, so the read never opts the route back into
 * dynamic rendering.
 */
export const revalidate = 300;

/**
 * Landing page — Phase 2 (architecture.md §12).
 *
 * Ported from design/03-mockups/landing.html to a Next.js 16 App Router
 * server component. All copy is sourced from the `Landing` namespace so
 * the EN ↔ 繁中 switch via the <LanguageToggle /> re-renders the page
 * with the matching message bundle.
 *
 * Phase 10 (OOP-4226):
 *   - slice 2: closed-beta waitlist capture (`Landing.waitlist.*` copy
 *     + `<WaitlistForm />`). The form submits via `joinWaitlistAction`
 *     — the only insert path because `public.waitlist` has no anon
 *     INSERT policy.
 *   - slice 3: footer links to `/privacy`, `/terms`, `/support`, and
 *     `/status` now point at the Phase 10 routes (legal pages were
 *     `#` placeholders until those pages shipped).
 *
 * OOP-5390: replaced the inline anonymous nav with the shared <Nav />
 * component so signed-in users (e.g. test users landing on `/` after
 * `signInAction`'s `redirect('/')` in src/lib/actions/auth.ts) see an
 * authed link set (Browse / Create / View profile / Sign out) instead
 * of the "Sign in / Start free" CTA. The shared Nav already handles
 * anon rendering, so no separate anon path is needed.
 *
 * OOP-6712 — the catalogue preview. The catalogue had 9 live listings and
 * no route into it from `/`: the nav only offered "Browse" to signed-in
 * users, so every anonymous visitor and every crawler bounced off the
 * marketplace. This section renders the real listings (title, creator,
 * price) straight from the catalogue feed, and the nav now links
 * `/browse` for everyone.
 */
export default async function Home({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Landing');

  // Live catalogue listings. The feed swallows its own query errors and
  // returns an empty list; this catch covers the rest (a missing Supabase
  // key, a client that cannot be constructed). Either way the section
  // degrades to a link to /browse rather than taking the landing page —
  // the top of the funnel — down with it.
  let previewGifts: Awaited<ReturnType<typeof getCatalogFeed>>['gifts'] = [];
  try {
    const { gifts } = await getCatalogFeed({ sort: 'published_desc' });
    previewGifts = gifts.slice(0, CATALOGUE_PREVIEW_COUNT);
  } catch (err) {
    console.error('[landing/catalogue-preview]', err);
  }

  const features = [
    { id: 'cards', emoji: '🎴' },
    { id: 'puzzle', emoji: '🧩' },
    { id: 'quiz', emoji: '💬' },
    { id: 'collage', emoji: '🎞️' },
    { id: 'letter', emoji: '💌' },
    { id: 'code', emoji: '💻' },
  ] as const;

  const steps = [1, 2, 3] as const;

  return (
    <main className="min-h-screen flex flex-col">
      {/* OOP-6710 — `deferAuth` keeps the auth cookie out of this tree so
          the landing page can be prerendered once per locale. */}
      <Nav deferAuth />

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
          <Link href="/browse" className="lb-btn lb-btn--ghost">
            {t('hero.ctaSecondary')}
          </Link>
        </div>
      </section>

      {/*
        OOP-6712 — the live catalogue. Before this, `/` had no route into
        the marketplace at all for an anonymous visitor: the nav's "Browse"
        was authed-only and the only gift on the page was the `/g/demo`
        mock. These are the real listings, read from the catalogue feed.
      */}
      <section className="lb-landing-catalogue" aria-labelledby="catalogue-heading">
        <div className="lb-container">
          <span className="lb-tag">{t('catalogue.tag')}</span>
          <h2 id="catalogue-heading">{t('catalogue.heading')}</h2>
          <p className="lede">{t('catalogue.lede')}</p>
          <ul className="lb-gift-grid lb-landing-catalogue__grid">
            {previewGifts.map((gift) => (
              <li key={gift.id}>
                <GiftCard gift={gift} />
              </li>
            ))}
          </ul>
          <p className="lb-landing-catalogue__more">
            <Link href="/browse" className="lb-btn lb-btn--ghost">
              {t('catalogue.cta')}
            </Link>
            {' · '}
            <Link href="/g/demo" className="lb-link">
              {t('catalogue.demoCta')}
            </Link>
          </p>
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

      {/*
        Phase 10 waitlist capture — the list of people who want to hear
        when something new lands. Server Component, so the form is
        hydrated as a child; the action path is the only insert into
        `public.waitlist`.

        OOP-6712: the copy no longer frames the product as an invite-only
        closed beta. That claim contradicted the live, priced catalogue
        above — the site was asking crawlers to index a shop it told them
        they could not enter.
      */}
      <section className="lb-waitlist-section" aria-labelledby="waitlist-heading">
        <div className="lb-waitlist-card">
          <span className="lb-tag">{t('waitlist.tag')}</span>
          <h2 id="waitlist-heading">{t('waitlist.heading')}</h2>
          <p className="lede">{t('waitlist.lede')}</p>
          <WaitlistForm turnstileEnabled={turnstileEnabled()} />
        </div>
      </section>

      <footer className="lb-landing-foot">
        <p>
          {t('footer.line')}{' '}
          <Link href="/support">{t('footer.support')}</Link>
          {' · '}
          <Link href="/privacy">{t('footer.privacy')}</Link>
          {' · '}
          <Link href="/terms">{t('footer.terms')}</Link>
          {' · '}
          <Link href="/status">{t('footer.status')}</Link>
        </p>
      </footer>
    </main>
  );
}
