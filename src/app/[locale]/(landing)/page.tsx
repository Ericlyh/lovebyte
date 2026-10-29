import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { GiftCard } from '@/components/catalog/GiftCard';
import { WaitlistForm } from '@/components/WaitlistForm';
import { TrackView } from '@/components/analytics/TrackView';
import { TrackedLink } from '@/components/analytics/TrackedLink';
import { getCatalogFeed } from '@/lib/catalog';
import { turnstileEnabled } from '@/lib/turnstile';
import { BRAND_OG_IMAGE, buildMetadata } from '@/lib/seo/metadata';

/**
 * OOP-6727 — the homepage's own title and description.
 *
 * It used to inherit the root layout's "Lovorithm — Send a feeling, not
 * just a gift", which is a brand line, not a description of anything.
 * It named no query, so the one page every visitor lands on was the one
 * page that could not be found by searching for what the site does.
 *
 * The format names in the title are the three that have a builder
 * behind them; the other three live on /gifts.
 */
export const metadata: Metadata = buildMetadata({
  path: '/',
  title: 'Personalised digital gifts: memory cards, quizzes and letters',
  description:
    'Turn your photos, voice notes and inside jokes into a one-of-a-kind digital gift — a memory card game, a personalised quiz, an animated letter. Made in Hong Kong.',
  imageUrl: BRAND_OG_IMAGE,
});

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

      {/* OOP-6716 — the landing view is the top of the funnel. It is
          reported from the browser because this page is prerendered once
          per locale: a server-side hook would fire once per build
          window instead of once per visitor. */}
      <TrackView event="landing_view" />

      <section className="lb-landing-hero">
        <span className="lb-tag">{t('hero.tag')}</span>
        <h1>
          {t('hero.line1')}
          <br />
          {t('hero.line2')}
        </h1>
        <p className="lede">{t('hero.lede')}</p>
        <div className="lb-landing-cta-row">
          <TrackedLink
            event="cta_click"
            props={{ cta: 'create' }}
            href="/create"
            className="lb-btn lb-btn--primary"
          >
            {t('hero.ctaPrimary')}
          </TrackedLink>
          <TrackedLink
            event="cta_click"
            props={{ cta: 'browse' }}
            href="/browse"
            className="lb-btn lb-btn--ghost"
          >
            {t('hero.ctaSecondary')}
          </TrackedLink>
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
                {/* OOP-6738 — the preview sits under this section's h2,
                    so a card title is an h3, not an h2. */}
                <GiftCard gift={gift} headingLevel="h3" />
              </li>
            ))}
          </ul>
          <p className="lb-landing-catalogue__more">
            <TrackedLink
              event="cta_click"
              props={{ cta: 'browse' }}
              href="/browse"
              className="lb-btn lb-btn--ghost"
            >
              {t('catalogue.cta')}
            </TrackedLink>
            {' · '}
            <TrackedLink
              event="cta_click"
              props={{ cta: 'demo' }}
              href="/g/demo"
              className="lb-link"
            >
              {t('catalogue.demoCta')}
            </TrackedLink>
          </p>
        </div>
      </section>

      {/*
        OOP-6738 — the section's own heading.

        The six format cards are h3s, and they sat directly under the
        page's h1 with no h2 in between: a screen-reader user rotating
        through the headings heard six h3s with nothing to say what they
        were (WCAG 1.3.1). The h2 they belong to did not exist — the
        section only carried an aria-label.

        The heading is rendered for screen readers only (`.lb-sr-only`,
        which is out of the grid flow) so the landing page's visual
        design is untouched: the six cards have always been a bare
        grid, and a visible section title is a design change rather
        than an accessibility fix.
      */}
      <section className="lb-features" aria-labelledby="lb-features-heading">
        <h2 id="lb-features-heading" className="lb-sr-only">
          {t('features.heading')}
        </h2>
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
              {/* OOP-6738 — an h3 under this section's h2. As an h4 it
                  skipped a level. */}
              <h3>{t(`how.steps.${n}.title`)}</h3>
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
