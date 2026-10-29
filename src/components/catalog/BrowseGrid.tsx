'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CatalogGift } from '@/lib/catalog';
import { GiftCardClient } from './GiftCardClient';
import { BROWSE_PARAMS_CHANGED, readBrowseParams, type BrowseParams } from './browseParams';

/**
 * The /browse grid (OOP-6710).
 *
 * The page itself is prerendered once per locale, but a prerendered page
 * cannot hold a live catalog — and the catalog is empty at build time, so a
 * build-time grid would ship empty and stay that way until the next
 * deploy. The grid therefore fetches in the browser and the page stays a
 * static shell: the hero, the controls and the nav are served from the
 * edge, and only the listing data is fetched live.
 *
 * Crawlers still reach every listing: `sitemap.xml` lists each listed gift
 * and each creator profile, and it reads the same feed this grid does.
 */
type FeedState = {
  status: 'loading' | 'ready' | 'error';
  gifts: CatalogGift[];
  nextCursor: string | null;
  /** True when the URL carries a search term — the feed and search paths differ. */
  isSearch: boolean;
};

/**
 * One page of the catalog. Search hits `/api/catalog/search`; everything
 * else hits `/api/catalog/feed`, which is also what the old server render
 * used, so the two paths cannot drift.
 */
async function fetchFeed(
  params: BrowseParams,
  cursor?: string,
): Promise<{ gifts: CatalogGift[]; nextCursor: string | null }> {
  if (params.q) {
    const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(params.q)}`);
    if (!res.ok) throw new Error(`catalog search failed: ${res.status}`);
    const data = (await res.json()) as { gifts?: CatalogGift[] };
    return { gifts: data.gifts ?? [], nextCursor: null };
  }

  const query = new URLSearchParams();
  if (params.category) query.set('category', params.category);
  if (params.priceTier) query.set('priceTier', params.priceTier);
  if (params.creator) query.set('creator', params.creator);
  if (params.sort && params.sort !== 'published_desc') query.set('sort', params.sort);
  if (cursor) query.set('cursor', cursor);

  const res = await fetch(`/api/catalog/feed?${query.toString()}`);
  if (!res.ok) throw new Error(`catalog feed failed: ${res.status}`);
  const data = (await res.json()) as { gifts?: CatalogGift[]; nextCursor?: string | null };
  return { gifts: data.gifts ?? [], nextCursor: data.nextCursor ?? null };
}

export function BrowseGrid() {
  const t = useTranslations('Catalog.browse');
  const [state, setState] = useState<FeedState>({
    status: 'loading',
    gifts: [],
    nextCursor: null,
    isSearch: false,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  // Load on mount, and again whenever the controls change the filters.
  useEffect(() => {
    let cancelled = false;

    async function reload() {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const params = readBrowseParams(window.location.search);
        const page = await fetchFeed(params);
        if (!cancelled) {
          setState({
            status: 'ready',
            gifts: page.gifts,
            nextCursor: page.nextCursor,
            isSearch: Boolean(params.q),
          });
        }
      } catch {
        if (!cancelled) {
          setState({
            status: 'error',
            gifts: [],
            nextCursor: null,
            isSearch: false,
          });
        }
      }
    }

    reload();
    window.addEventListener(BROWSE_PARAMS_CHANGED, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(BROWSE_PARAMS_CHANGED, reload);
    };
  }, []);

  async function loadMore() {
    if (!state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchFeed(
        readBrowseParams(window.location.search),
        state.nextCursor,
      );
      setState((s) => ({
        status: 'ready',
        gifts: [...s.gifts, ...page.gifts],
        nextCursor: page.nextCursor,
        isSearch: s.isSearch,
      }));
    } catch {
      // Keep what we have — a failed "load more" should not blank the grid.
    }
    setLoadingMore(false);
  }

  if (state.status === 'loading') {
    return (
      <p className="lb-browse-empty" role="status">
        {t('loading')}
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <p className="lb-browse-empty" role="alert">
        {t('error')}
      </p>
    );
  }

  if (state.gifts.length === 0) {
    return (
      <div className="lb-browse-empty">
        <p>{t('empty')}</p>
        {!state.isSearch ? (
          <p>
            <Link href="/signup" className="lb-link">
              {t('emptyCta')}
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <ul className="lb-gift-grid">
        {state.gifts.map((gift) => (
          <li key={gift.id}>
            {/* OOP-6738 — the grid is the top-level content of /browse,
                so a card title is an h2 under the page's h1. As an h3
                it skipped a level, which breaks the heading rotor. */}
            <GiftCardClient gift={gift} headingLevel="h2" />
          </li>
        ))}
      </ul>

      {state.nextCursor ? (
        <p className="lb-browse-more">
          <button
            type="button"
            className="lb-btn lb-btn--ghost"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </p>
      ) : null}
    </>
  );
}
