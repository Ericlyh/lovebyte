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
 */

export const runtime = 'nodejs';

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
  });
}
