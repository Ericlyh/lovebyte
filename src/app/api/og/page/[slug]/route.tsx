import { ImageResponse } from 'next/og';
import { GIFT_PAGES } from '@/content/gifts';
import { OgCard } from '@/lib/og/card';

/**
 * /api/og/page/[slug] — the social card for a public page.
 *
 * OOP-6727. `/browse` shared into a chat used to unfurl with the site's
 * generic brand card. It now has a card of its own, and so does every
 * gift guide under `/gifts/<slug>`.
 *
 * The slug is resolved against a fixed set — the catalogue and the gift
 * guide registry — so this route never renders anything a visitor typed.
 *
 * Runtime: nodejs, for the same reason as the listing card next door
 * (OOP-6727): the edge isolate blocks on DNS and cannot be interrupted.
 *
 * Caching (OOP-6724): this route touches no database — the slug is
 * resolved against a fixed in-repo registry — so the card is cached at
 * the edge. The TTL is short rather than immutable because the card's
 * text lives in the code: a deploy that rewrites a guide's title would
 * otherwise leave the old card in the CDN for a year.
 */

export const runtime = 'nodejs';

/** Edge cache lifetime for the card. */
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';

const BROWSE_CARD = {
  eyebrow: 'The catalogue',
  title: 'Browse personalised digital gifts',
  subtitle:
    'Memory cards, quizzes, letters and collages — made by people, sent as a link.',
};

const GIFTS_CARD = {
  eyebrow: 'Gift guides',
  title: 'What to send, and when',
  subtitle:
    'Seven guides to the gifts you can make here — and the ones worth sending.',
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  const page = GIFT_PAGES.find((candidate) => candidate.slug === slug);
  const card = page
    ? {
        eyebrow: 'Gift guide',
        title: page.metaTitle.en,
        subtitle: page.metaDescription.en,
      }
    : slug === 'browse'
      ? BROWSE_CARD
      : slug === 'gifts'
        ? GIFTS_CARD
        : null;

  if (!card) {
    return new Response('Not found', { status: 404 });
  }

  return new ImageResponse(<OgCard {...card} />, {
    width: 1200,
    height: 630,
    headers: { 'cache-control': CACHE_CONTROL },
  });
}
