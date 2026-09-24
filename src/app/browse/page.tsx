import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { BrowseControls } from '@/components/catalog/BrowseControls';
import { GiftCard } from '@/components/catalog/GiftCard';
import { getCatalogFeed, searchCatalog, FeedQuerySchema } from '@/lib/catalog';
import { BRAND } from '@/lib/brand';

/**
 * /browse — public catalog (M-C, OOP-4275).
 *
 * Server component. Reads filters from the URL via FeedQuerySchema,
 * dispatches to `getCatalogFeed` (or `searchCatalog` when `q` is set),
 * and renders a grid of GiftCards.
 *
 * Search vs. feed: when `?q=...` is present we run `searchCatalog`
 * (FTS, no pagination) and ignore the other filters. The user can
 * clear the query to fall back to the filterable feed.
 *
 * Cursor pagination: `nextCursor` is rendered as a "Load more" link.
 * No client-side fetch — the next page is a full SSR render with the
 * cursor appended. Keeps the JS surface small and means a back-button
 * navigation always lands on a complete page state.
 */
type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams;
  const query = typeof sp.q === 'string' ? sp.q : '';
  const title = query
    ? `Search "${query}" — ${BRAND.NAME} marketplace`
    : `Browse gifts — ${BRAND.NAME} marketplace`;
  return {
    title,
    description:
      'Five kinds of personalised gifts from independent creators. Find a memory card game, photo puzzle, quiz, collage, or animated letter for the people you love.',
  };
}

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function BrowsePage({ searchParams }: Props) {
  const sp = await searchParams;
  const t = await getTranslations('Catalog');

  const params = {
    category: pickFirst(sp.category),
    priceTier: pickFirst(sp.priceTier),
    creator: pickFirst(sp.creator),
    sort: pickFirst(sp.sort),
    cursor: pickFirst(sp.cursor),
    q: pickFirst(sp.q),
  };

  const isSearch = typeof params.q === 'string' && params.q.trim().length > 0;
  let gifts: Awaited<ReturnType<typeof getCatalogFeed>>['gifts'] = [];
  let nextCursor: string | null = null;
  let feedParams: Record<string, string | undefined> = {};

  if (isSearch) {
    const searchResult = await searchCatalog({ q: params.q });
    gifts = searchResult.gifts;
  } else {
    const feedParamsParsed = FeedQuerySchema.safeParse({
      category: params.category,
      priceTier: params.priceTier,
      creator: params.creator,
      sort: params.sort,
      cursor: params.cursor,
    });
    if (feedParamsParsed.success) {
      const feedResult = await getCatalogFeed(feedParamsParsed.data);
      gifts = feedResult.gifts;
      nextCursor = feedResult.nextCursor;
    }
    feedParams = {
      category: params.category,
      priceTier: params.priceTier,
      creator: params.creator,
      sort: params.sort,
    };
  }

  // Build the "Load more" URL preserving the current filters + new cursor.
  const loadMoreHref = nextCursor
    ? `/browse?${new URLSearchParams({
        ...feedParams,
        cursor: nextCursor,
      }).toString()}`
    : null;

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <section className="lb-browse-hero">
        <div className="lb-container">
          <h1 className="lb-browse-hero__title">{t('browse.heading')}</h1>
          <p className="lb-browse-hero__lede">{t('browse.lede')}</p>
        </div>
      </section>

      <section className="lb-container lb-browse-body">
        <BrowseControls
          initialCategory={params.category}
          initialPriceTier={params.priceTier}
          initialCreator={params.creator}
          initialSort={params.sort ?? 'published_desc'}
          initialQuery={params.q}
        />

        {gifts.length === 0 ? (
          <div className="lb-browse-empty">
            <p className="lb-empty">{t('browse.empty')}</p>
            {!isSearch ? (
              <p>
                <Link href="/signup" className="lb-link">
                  {t('browse.emptyCta')}
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <ul className="lb-gift-grid">
              {gifts.map((gift) => (
                <li key={gift.id}>
                  <GiftCard gift={gift} />
                </li>
              ))}
            </ul>

            {loadMoreHref ? (
              <p className="lb-browse-more">
                <Link href={loadMoreHref} className="lb-btn lb-btn--ghost">
                  {t('browse.loadMore')}
                </Link>
              </p>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
