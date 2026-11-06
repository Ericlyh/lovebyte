import { NextRequest, NextResponse } from 'next/server';
import { getPublicListingDetail } from '@/lib/catalog';

/** Edge cache lifetime for a preview payload. */
const CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=60';

/**
 * GET /api/catalog/preview/[giftId]
 *
 * The gift a browser of /browse is asking to preview (OOP-7451).
 *
 * ## Why this is a separate route
 *
 * The catalogue FEED deliberately does not carry the payload. The feed
 * selects `payload` out of Postgres (the cover URL is derived from it),
 * but `CatalogGift` drops it — a code gift's payload is up to 200 KB of
 * HTML/CSS/JS, and a feed page of twenty of those is four megabytes of
 * JSON for a grid that shows covers.
 *
 * The preview is a deliberate, one-gift-at-a-time fetch: the visitor
 * asked for this gift, so this gift's bytes are worth sending.
 *
 * ## What it exposes, and why
 *
 * The gift's content — the letter's text, the quiz's questions, the
 * collage's photos. That content is what the listing is SELLING: the
 * listing page's own CTA is "Send this gift →", which takes the buyer
 * to the checkout for THIS gift. A buyer who cannot see what they are
 * buying is being asked to pay for a cover photo and a title.
 *
 * The recipient's surprise is untouched: the buyer is the customer, and
 * the recipient still opens the gift for the first time at
 * `/g/[token]/open`.
 *
 * It exposes published, listed, non-deleted gifts only — the read is
 * the same RLS-gated one the listing page uses
 * (`gifts_select_public_listed`), so an unpublished gift 404s here the
 * same way it 404s on `/l/[giftId]`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ giftId: string }> },
) {
  const { giftId } = await params;
  const listing = await getPublicListingDetail(giftId);

  if (!listing) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(
    {
      gift: {
        id: listing.id,
        type: listing.type,
        title: listing.title,
        payload: listing.payload,
        kind: listing.kind,
        // The creator is the sender of the gift they published.
        senderName: listing.owner.display_name ?? listing.owner.handle,
      },
    },
    { headers: { 'cache-control': CACHE_CONTROL } },
  );
}
