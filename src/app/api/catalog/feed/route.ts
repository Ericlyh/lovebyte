import { NextRequest, NextResponse } from 'next/server';
import { getCatalogFeed } from '@/lib/catalog';

/** Edge cache lifetime for the feed. */
const CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=60';

/**
 * GET /api/catalog/feed
 *
 * Anon-readable paginated feed (M-C, OOP-4275). Query params:
 *   ?category=<category>     filter by gift category
 *   ?priceTier=<tier>        free | under_50 | under_200 | over_200
 *   ?creator=<handle>        filter to one creator's gifts
 *   ?sort=<sort>             published_desc | most_liked | price_asc
 *   ?cursor=<opaque>         cursor from a previous response
 *
 * Returns `{ gifts: CatalogGift[], nextCursor: string | null }`. The
 * `nextCursor` is null when the current page is the last one. RLS is
 * the access boundary — the query is gated by `gifts_select_public_listed`
 * so anon clients get exactly the same view as a logged-in visitor.
 *
 * Every gift is priced in the settlement currency, HKD (OOP-6714), so
 * `gifts[].currency` is always "hkd" and `price_cents` is always HKD
 * cents. The price-tier bands are HKD cents too.
 *
 * Caching (OOP-6724): the feed used to be `no-store`, on the assumption
 * that it carries the visitor's own listings and interactions. It does
 * not. The read is cookie-free (`createPublicClient`) and the response
 * holds only public listing fields plus a GLOBAL like count — the
 * `gift_likes(count)` aggregate, not "did I like this" (the per-visitor
 * like state is fetched client-side, separately).
 *
 * That was proved, not assumed: the feed was fetched anonymously and as
 * two different signed-in accounts, and all three bodies were
 * byte-identical. So the feed is now cached at the edge for 30 s and
 * served stale for another 60 s while it revalidates; the write side
 * calls `revalidatePath`, and the short TTL bounds how long a newly
 * published listing can be missing from the cached copy.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = {
    category: sp.get('category') ?? undefined,
    priceTier: sp.get('priceTier') ?? undefined,
    creator: sp.get('creator') ?? undefined,
    sort: sp.get('sort') ?? undefined,
    cursor: sp.get('cursor') ?? undefined,
  };

  const result = await getCatalogFeed(params);
  return NextResponse.json(result, {
    headers: { 'cache-control': CACHE_CONTROL },
  });
}
