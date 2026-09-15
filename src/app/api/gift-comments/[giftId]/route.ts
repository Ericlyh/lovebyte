import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getListingComments } from '@/lib/catalog';

/**
 * GET /api/gift-comments/[giftId]?cursor=<opaque>
 *
 * Paginated comments for the gift's thread (M-D, OOP-4276).
 *
 * Cursor is opaque base64url of `created_at|id` — produced by
 * `getListingComments` in `src/lib/catalog.ts`. Pass it back as-is.
 * Page size is fixed at 10 by the query helper (matches acceptance).
 *
 * Status codes:
 *   200 { comments: [...], nextCursor, totalCount }
 *   400 { error }  — giftId is not a uuid, or cursor is malformed
 *   500 { error }  — unexpected DB / RLS failure
 */
export const runtime = 'nodejs';

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

  const result = await getListingComments(giftId, parsed.data.cursor ?? null);
  return NextResponse.json(result);
}