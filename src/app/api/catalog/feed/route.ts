import { NextRequest, NextResponse } from 'next/server';
import { getCatalogFeed } from '@/lib/catalog';

/**
 * GET /api/catalog/feed
 *
 * Anon-readable paginated feed (M-C, OOP-4275). Query params:
 *   ?category=<category>     filter by gift category
 *   ?priceTier=<tier>        free | under_5 | under_20 | over_20
 *   ?creator=<handle>        filter to one creator's gifts
 *   ?sort=<sort>             published_desc | most_liked | price_asc
 *   ?cursor=<opaque>         cursor from a previous response
 *
 * Returns `{ gifts: CatalogGift[], nextCursor: string | null }`. The
 * `nextCursor` is null when the current page is the last one. RLS is
 * the access boundary — the query is gated by `gifts_select_public_listed`
 * so anon clients get exactly the same view as a logged-in visitor.
 *
 * Caching: `cache: 'no-store'` because the feed reflects the user's
 * own listings + interactions in real time. We can add a 5–10s SWR
 * once the catalog stabilises post-MVP.
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
    headers: { 'cache-control': 'no-store' },
  });
}
