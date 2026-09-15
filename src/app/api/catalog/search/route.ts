import { NextRequest, NextResponse } from 'next/server';
import { searchCatalog } from '@/lib/catalog';

/**
 * GET /api/catalog/search?q=<query>&limit=<n>
 *
 * Anon-readable full-text search (M-C, OOP-4275). Returns the first
 * `limit` matches (default 20, max 40). The same RLS policy applies as
 * `/api/catalog/feed`.
 *
 * We intentionally do NOT cache search responses — they're small and
 * personalised enough (recently-published gifts should surface first)
 * that any SWR window would feel stale.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const params = {
    q: sp.get('q') ?? '',
    limit: sp.get('limit') ?? undefined,
  };
  const result = await searchCatalog(params);
  return NextResponse.json(result, {
    headers: { 'cache-control': 'no-store' },
  });
}
