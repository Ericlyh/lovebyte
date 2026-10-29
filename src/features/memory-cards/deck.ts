import type { MemoryCardsPayload } from '@/features/memory-cards/schemas';

/**
 * The memory-cards deck — the order the cards are dealt in.
 *
 * Two properties matter, and both are easy to break:
 *
 *   1. **Deterministic.** The server renders the deck during SSR and the
 *      client builds it again during hydration. If the two disagree, the
 *      game breaks in a way nobody can see in the source: React hydrates
 *      the cards BY KEY (`0-a`, `1-b`, …), so the server's element order
 *      survives in the DOM while the client supplies different values
 *      for those same keys. The player then sees two cards with the same
 *      photo that the game calls "not a match" — and the win state is
 *      unreachable. `Math.random()` in the deck shuffle is exactly that
 *      bug (OOP-6718).
 *
 *   2. **Pairs separated.** The two cards of a pair are never
 *      neighbours, so the game is not a gift of two points.
 *
 * The order is therefore seeded from the gift's own photos: the same
 * gift always deals the same way, for every recipient, on both sides of
 * the render.
 */

export type MemoryCard = {
  /** Stable id per card instance (different positions in the same pair). */
  cardId: string;
  /** Photo URL — the matching key. Two cards share this when they're a pair. */
  photoUrl: string;
  caption: string;
};

/**
 * mulberry32 — a tiny seeded PRNG.
 *
 * Not cryptographic, and it does not need to be: the seed is the gift's
 * own content, and the only requirement is that the server and the
 * client compute the same sequence.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a over the payload's photo URLs — a stable seed for the deal.
 *
 * The same gift always deals the same order, which is what SSR and the
 * client need to agree on. It is not a secret.
 */
function seedFromPhotoUrls(photoUrls: string[]): number {
  let hash = 0x811c9dc5;
  for (const url of photoUrls) {
    for (let i = 0; i < url.length; i++) {
      hash ^= url.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

/**
 * Build the deck for a memory-cards gift.
 *
 * The PAIRS are shuffled, then each pair's two cards are dealt into
 * opposite halves of the deck — the first card of every pair in the
 * first half, the second in the second half. Pair-mates therefore end
 * up exactly `pairs.length` apart and are never neighbours.
 */
export function buildMemoryDeck(payload: MemoryCardsPayload): MemoryCard[] {
  const pairOrder = payload.pairs.map((_, i) => i);
  const rand = mulberry32(seedFromPhotoUrls(payload.pairs.map((p) => p.photo_url)));

  for (let i = pairOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairOrder[i], pairOrder[j]] = [pairOrder[j], pairOrder[i]];
  }

  const half = pairOrder.length;
  const cards: MemoryCard[] = new Array(half * 2);
  pairOrder.forEach((pairIdx, slot) => {
    const pair = payload.pairs[pairIdx];
    cards[slot] = {
      cardId: `${pairIdx}-a`,
      photoUrl: pair.photo_url,
      caption: pair.caption,
    };
    cards[slot + half] = {
      cardId: `${pairIdx}-b`,
      photoUrl: pair.photo_url,
      caption: pair.caption,
    };
  });
  return cards;
}
