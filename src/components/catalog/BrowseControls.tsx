'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Browse controls — search input + sort + category pills (M-C, OOP-4275).
 *
 * Client component because the search box debounces and pushes to the URL
 * (server reads the params on the next render). Filters are URL-driven so
 * `/browse?category=quiz&priceTier=under_5` is shareable.
 *
 * The debounce window is 300ms — fast enough that the URL updates while
 * the user is still typing the last word, slow enough that we don't
 * trigger an SSR round-trip per keystroke.
 */
type Props = {
  initialCategory?: string;
  initialPriceTier?: string;
  initialCreator?: string;
  initialSort?: string;
  initialQuery?: string;
};

const CATEGORIES = [
  'memory_cards',
  'dragdrop_puzzle',
  'quiz',
  'multimedia_collage',
  'animated_letter',
] as const;

const PRICE_TIERS = ['free', 'under_5', 'under_20', 'over_20'] as const;

const SORTS = ['published_desc', 'most_liked', 'price_asc'] as const;

export function BrowseControls(props: Props) {
  const t = useTranslations('Catalog.controls');
  const router = useRouter();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState(props.initialQuery ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push a URL change whenever a filter changes. Search input is
  // debounced separately below so it doesn't fight the other controls.
  function pushParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === '') params.delete(k);
      else params.set(k, v);
    }
    // Any filter change resets the cursor to page 1.
    params.delete('cursor');
    startTransition(() => {
      router.replace(`/browse?${params.toString()}`);
    });
  }

  function setCategory(cat: string | null) {
    pushParams({ category: cat });
  }
  function setPriceTier(tier: string | null) {
    pushParams({ priceTier: tier });
  }
  function setCreator(handle: string) {
    pushParams({ creator: handle.trim() || null });
  }
  function setSort(sort: string) {
    pushParams({ sort: sort === 'published_desc' ? null : sort });
  }

  // Debounced search push.
  useEffect(() => {
    if (query === (props.initialQuery ?? '')) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ q: query.trim() || null });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const currentCategory = props.initialCategory ?? '';
  const currentPriceTier = props.initialPriceTier ?? '';
  const currentSort = props.initialSort ?? 'published_desc';

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
            defaultValue={props.initialCreator ?? ''}
            placeholder={t('creatorPlaceholder')}
            onBlur={(e) => setCreator(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setCreator((e.target as HTMLInputElement).value);
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
