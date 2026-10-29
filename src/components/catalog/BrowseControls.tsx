'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  BROWSE_PARAMS_CHANGED,
  readBrowseParams,
  writeBrowseParams,
  type BrowseParams,
} from './browseParams';

/**
 * Browse controls — search input + sort + category pills (M-C, OOP-4275).
 *
 * Client component because the search box debounces and pushes to the URL.
 * Filters are URL-driven so `/browse?category=quiz&priceTier=under_5` is
 * shareable.
 *
 * The debounce window is 300ms — fast enough that the URL updates while
 * the user is still typing the last word, slow enough that we don't
 * trigger a reload per keystroke.
 *
 * OOP-6710: the page is prerendered once per locale, so the filters can no
 * longer arrive as props from a server render that read `searchParams`.
 * They are read from the address bar instead, and written back to it with
 * `history.replaceState` — a URL change, not a navigation.
 */
const CATEGORIES = [
  'memory_cards',
  'dragdrop_puzzle',
  'quiz',
  'multimedia_collage',
  'animated_letter',
  'code',
] as const;

const PRICE_TIERS = ['free', 'under_5', 'under_20', 'over_20'] as const;

const SORTS = ['published_desc', 'most_liked', 'price_asc'] as const;

export function BrowseControls() {
  const t = useTranslations('Catalog.controls');

  const [params, setParams] = useState<BrowseParams>({});
  const [query, setQuery] = useState('');
  const [creator, setCreator] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The text inputs are seeded from the URL once, on mount. After that
  // they are the user's, so a filter change elsewhere on the page does not
  // wipe what they are typing.
  const seeded = useRef(false);

  // Read the filters from the address bar, and keep them in step with it.
  useEffect(() => {
    const sync = () => {
      const next = readBrowseParams(window.location.search);
      setParams(next);
      if (!seeded.current) {
        seeded.current = true;
        setQuery(next.q ?? '');
        setCreator(next.creator ?? '');
      }
    };
    sync();
    window.addEventListener(BROWSE_PARAMS_CHANGED, sync);
    return () => {
      window.removeEventListener(BROWSE_PARAMS_CHANGED, sync);
    };
  }, []);

  // Push a URL change whenever a filter changes. Search input is
  // debounced separately below so it doesn't fight the other controls.
  function pushParams(next: Record<string, string | null>) {
    writeBrowseParams(next);
  }

  function setCategory(cat: string | null) {
    pushParams({ category: cat });
  }

  function setPriceTier(tier: string | null) {
    pushParams({ priceTier: tier });
  }

  function setCreatorFilter(handle: string) {
    pushParams({ creator: handle.trim() || null });
  }

  function setSort(sort: string) {
    pushParams({ sort: sort === 'published_desc' ? null : sort });
  }

  // Debounced search push.
  useEffect(() => {
    if (query === (params.q ?? '')) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ q: query.trim() || null });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const currentCategory = params.category ?? '';
  const currentPriceTier = params.priceTier ?? '';
  const currentSort = params.sort ?? 'published_desc';

  return (
    <div className="lb-browse-controls">
      <div className="lb-browse-controls__search-row">
        <input
          type="search"
          className="lb-input"
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t('searchAria')}
        />
      </div>

      <div className="lb-browse-controls__row">
        <div className="lb-browse-controls__group" role="group" aria-label={t('categoryAria')}>
          <button
            type="button"
            className={`lb-pill ${currentCategory === '' ? 'lb-pill--active' : ''}`}
            onClick={() => setCategory(null)}
          >
            {t('categoryAll')}
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`lb-pill ${currentCategory === c ? 'lb-pill--active' : ''}`}
              onClick={() => setCategory(currentCategory === c ? null : c)}
            >
              {t(`category.${c}`)}
            </button>
          ))}
        </div>
        <div className="lb-browse-controls__group" role="group" aria-label={t('priceAria')}>
          {PRICE_TIERS.map((p) => (
            <button
              key={p}
              type="button"
              className={`lb-pill ${currentPriceTier === p ? 'lb-pill--active' : ''}`}
              onClick={() => setPriceTier(currentPriceTier === p ? null : p)}
            >
              {t(`priceTier.${p}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="lb-browse-controls__row lb-browse-controls__row--meta">
        <label className="lb-browse-controls__creator">
          <span>{t('creatorLabel')}</span>
          <input
            type="text"
            className="lb-input lb-input--inline"
            value={creator}
            onChange={(e) => setCreator(e.target.value)}
            placeholder={t('creatorPlaceholder')}
            onBlur={(e) => setCreatorFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setCreatorFilter((e.target as HTMLInputElement).value);
            }}
          />
        </label>

        <label className="lb-browse-controls__sort">
          <span>{t('sortLabel')}</span>
          <select
            className="lb-select lb-select--inline"
            value={currentSort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
