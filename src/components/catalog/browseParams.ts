/**
 * The /browse query string, shared by the controls and the grid.
 *
 * OOP-6710: /browse is prerendered once per locale, so the page cannot read
 * `searchParams` — that is exactly what makes a route dynamic. The filters
 * live in the address bar instead, and these two client components read
 * and write them there.
 *
 * The controls write the URL and announce it; the grid listens and reloads.
 * `history.replaceState` is used rather than `router.replace` so the URL
 * updates synchronously — the grid reads it back immediately, and no
 * server round trip is needed for what is only a query string.
 */

/** Fired on `window` after the browse query string changes. */
export const BROWSE_PARAMS_CHANGED = 'lb:browse-params';

export type BrowseParams = {
  category?: string;
  priceTier?: string;
  creator?: string;
  sort?: string;
  q?: string;
  cursor?: string;
};

export function readBrowseParams(search: string): BrowseParams {
  const sp = new URLSearchParams(search);
  return {
    category: sp.get('category') ?? undefined,
    priceTier: sp.get('priceTier') ?? undefined,
    creator: sp.get('creator') ?? undefined,
    sort: sp.get('sort') ?? undefined,
    q: sp.get('q') ?? undefined,
    cursor: sp.get('cursor') ?? undefined,
  };
}

/**
 * Merge `next` into the current query string and put the result in the
 * address bar. A null or empty value removes the key.
 *
 * Any filter change resets the cursor — a cursor points at a position in
 * one ordering, and the new ordering has no such position.
 */
export function writeBrowseParams(next: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(next)) {
    if (v == null || v === '') params.delete(k);
    else params.set(k, v);
  }
  params.delete('cursor');

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new Event(BROWSE_PARAMS_CHANGED));
}
