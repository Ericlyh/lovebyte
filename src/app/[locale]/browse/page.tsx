import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { BrowseControls } from '@/components/catalog/BrowseControls';
import { BrowseGrid } from '@/components/catalog/BrowseGrid';
import { TrackView } from '@/components/analytics/TrackView';
import { JsonLd } from '@/components/seo/JsonLd';
import { BRAND } from '@/lib/brand';
import { breadcrumbJsonLd, browseUrl, homeUrl } from '@/lib/seo/jsonld';

/**
 * /browse — public catalog (M-C, OOP-4275).
 *
 * OOP-6710: this page is a static shell. The hero, the controls and the
 * nav are prerendered once per locale and served from the edge; the
 * listing grid is fetched in the browser by `BrowseGrid`.
 *
 * The reason it cannot stay a server render is the catalog itself. A
 * prerendered page holds the data it was built with, and the catalog is
 * empty at build time — a build-time grid would ship empty and stay empty
 * until the next deploy. Reading `searchParams` (the filters) would force
 * the route dynamic as well, which is the thing this page is trying to
 * avoid. So the filters live in the address bar and the grid reads them
 * there; see `components/catalog/browseParams.ts`.
 *
 * Crawlers still reach every listing: `sitemap.xml` lists each listed gift
 * and each creator profile, and reads the same feed this grid does.
 *
 * There is deliberately no `loading.tsx` or `not-found.tsx` in this
 * segment. Both call `getTranslations()` with no request locale, so
 * next-intl falls back to reading the `X-NEXT-INTL-LOCALE` request header —
 * and a `headers()` read opts the whole segment out of prerendering, which
 * is what kept /browse dynamic even after the locale moved into the route.
 * The segment-root `not-found.tsx` already renders the same `CommonNotFound`
 * card, and a static route never streams, so the loading skeleton had
 * nothing left to cover.
 *
 * Search vs. feed: when `?q=...` is present we run the search endpoint
 * (FTS, no pagination) and ignore the other filters. The user can clear
 * the query to fall back to the filterable feed.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function BrowsePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Catalog');
  // OOP-6728 — the breadcrumb labels are the nav's own, so they are
  // translated like the nav is.
  const tNav = await getTranslations('Nav');

  return (
    <main className="min-h-screen flex flex-col">
      {/* OOP-6728 — the trail from the site root to the catalogue. */}
      <JsonLd
        nodes={[
          breadcrumbJsonLd([
            { name: BRAND.NAME, url: homeUrl() },
            { name: tNav('browse'), url: browseUrl() },
          ]),
        ]}
      />

      {/* `deferAuth` keeps the auth cookie out of this tree so the page
          can be prerendered — same trade the landing page makes. */}
      <Nav deferAuth />

      {/* OOP-6716 — the browse step of the funnel. Reported from the
          browser because this page is prerendered once per locale. */}
      <TrackView event="browse_view" />

      <section className="lb-browse-hero">
        <div className="lb-container">
          <h1 className="lb-browse-hero__title">{t('browse.heading')}</h1>
          <p className="lb-browse-hero__lede">{t('browse.lede')}</p>
        </div>
      </section>

      <section className="lb-container lb-browse-body">
        <BrowseControls />
        <BrowseGrid />
      </section>
    </main>
  );
}
