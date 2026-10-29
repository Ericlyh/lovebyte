import { ImageResponse } from 'next/og';
import { getListingDetail } from '@/lib/catalog';
import { formatSettlementAmount } from '@/lib/money';
import { OgCard } from '@/lib/og/card';

/**
 * /api/og/listing/[giftId] — the social card for one marketplace listing.
 *
 * OOP-6727. Before this, `/l/[giftId]` had no `og:image` of its own, so
 * a listing shared into WhatsApp unfurled with the site's generic brand
 * card and the generic title — every listing looked identical, which is
 * the one thing a marketplace card cannot afford.
 *
 * Runtime: nodejs, not edge. The `/g/[token]` card above us still runs
 * on the edge, but that route was moved off edge in OOP-5816 because the
 * edge isolate resolves DNS in a way that blocks the whole isolate and
 * cannot be interrupted: when the Supabase host stopped resolving, that
 * page took 8.0 s to produce its markup. This route does the same kind
 * of read, so it does not go near the edge. The Node runtime reports
 * ENOTFOUND immediately and the network policy in
 * src/lib/supabase/net.ts short-circuits it.
 *
 * A card is never allowed to 500: a missing or unpublished listing falls
 * back to a generic card rather than an error, because a broken image in
 * a chat bubble is worse than a plain one.
 */

export const runtime = 'nodejs';

/** The gift format, in the words the catalogue uses for it. */
const TYPE_LABELS: Record<string, string> = {
  memory_cards: 'Memory card game',
  dragdrop_puzzle: 'Photo puzzle',
  quiz: 'Personalised quiz',
  multimedia_collage: 'Multimedia collage',
  animated_letter: 'Animated letter',
  code: 'Code gift',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ giftId: string }> },
) {
  const { giftId } = await context.params;

  let card = {
    eyebrow: 'Digital gift',
    title: 'A one-of-a-kind gift, made by someone for someone',
    subtitle: 'Open it on Lovorithm.',
  };

  try {
    const listing = await getListingDetail(giftId);
    if (listing) {
      const creator = listing.owner.display_name ?? `@${listing.owner.handle}`;
      card = {
        eyebrow: TYPE_LABELS[listing.type] ?? 'Digital gift',
        title: listing.title,
        subtitle: `by ${creator}`,
        detail:
          listing.price_cents == null
            ? 'Free'
            : formatSettlementAmount(listing.price_cents),
      };
    }
  } catch (err) {
    console.error('[og/listing]', err);
  }

  return new ImageResponse(<OgCard {...card} />, {
    width: 1200,
    height: 630,
  });
}
