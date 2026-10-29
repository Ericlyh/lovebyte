import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getListingReplies } from '@/lib/catalog';

/**
 * GET /api/gift-replies/[giftId]?cursor=<opaque>
 *
 * Paginated threaded replies for the gift's thread (M-G, OOP-4890).
 *
 * Cursor is opaque base64url of `created_at|id` — produced by
 * `getListingReplies` in `src/lib/catalog.ts`. Pass it back as-is.
 * Page size is fixed at 20 by the query helper (matches the rest of
 * the catalog helpers; comments use 10 — replies are cheaper to render
 * since they're thread-grouped client-side, so a bigger page makes
 * sense for first-paint threads).
 *
 * Status codes:
 *   200 { replies: [...], nextCursor, totalCount }
 *   400 { error }  — giftId is not a uuid, or cursor is malformed
 *   500 { error }  — unexpected DB / RLS failure
 *
 * Caching (OOP-6724): `gift_replies_select_public` is `using (true)` —
 * every role reads every reply — and the read is cookie-free, so the
 * response is cached at the edge for 30 s and served stale for another
 * 60 s while it revalidates. The write side
 * (`src/lib/actions/giftReplies.ts`) calls `revalidatePath`, and the
 * short TTL bounds how long a reply can be missing from the cached copy.
 */
export const runtime = 'nodejs';

/** Edge cache lifetime for the thread. */
const CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=60';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const querySchema = z.object({
  cursor: z.string().trim().min(1).max(120).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ giftId: string }> },
) {
  const { giftId } = await context.params;

  if (!UUID_RE.test(giftId)) {
    return NextResponse.json(
      { error: 'giftId must be a UUID.' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid query.' },
      { status: 400 },
    );
  }

  const result = await getListingReplies(giftId, parsed.data.cursor ?? null);
  return NextResponse.json(result, {
    headers: { 'cache-control': CACHE_CONTROL },
  });
}