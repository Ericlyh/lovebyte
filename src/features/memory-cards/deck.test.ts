import { describe, expect, it } from 'vitest';
import { buildMemoryDeck } from './deck';
import type { MemoryCardsPayload } from './schemas';

/**
 * Tests for the memory-cards deck (OOP-6718).
 *
 * The bug these pin: the deck was shuffled with `Math.random()` inside
 * a `useMemo`, so the server and the client built DIFFERENT decks.
 * React hydrates the cards by key, so the server's element order
 * survived while the client supplied different values for those keys —
 * and the player saw two identical photos that the game called "not a
 * match". The win state was unreachable in production.
 */

const PHOTO = 'https://example.test/photo';

function payload(photoUrls: string[]): MemoryCardsPayload {
  return {
    pairs: photoUrls.map((photo_url, i) => ({ photo_url, caption: `caption ${i}` })),
    difficulty: 'medium',
    music_url: null,
  };
}

/** Position of each card id in the deck. */
function positions(deck: ReturnType<typeof buildMemoryDeck>) {
  const pos: Record<string, number> = {};
  deck.forEach((card, i) => {
    pos[card.cardId] = i;
  });
  return pos;
}

describe('buildMemoryDeck', () => {
  it('deals two cards per pair', () => {
    const deck = buildMemoryDeck(payload([`${PHOTO}1`, `${PHOTO}2`, `${PHOTO}3`]));
    expect(deck).toHaveLength(6);
    expect(deck.map((c) => c.cardId).sort()).toEqual([
      '0-a',
      '0-b',
      '1-a',
      '1-b',
      '2-a',
      '2-b',
    ]);
  });

  it('is deterministic — the server and the client build the same deck', () => {
    // This is the invariant the bug broke: two calls with the same
    // payload must produce the same order, because the server renders
    // the deck during SSR and the client renders it again on hydration.
    const p = payload([`${PHOTO}1`, `${PHOTO}2`, `${PHOTO}3`]);
    expect(buildMemoryDeck(p)).toEqual(buildMemoryDeck(p));
  });

  it('deals a different gift a different order', () => {
    const a = buildMemoryDeck(payload([`${PHOTO}a1`, `${PHOTO}a2`]));
    const b = buildMemoryDeck(payload([`${PHOTO}b1`, `${PHOTO}b2`]));
    // Compare the PHOTOS dealt, not the card ids — the ids are positional
    // within a pair and say nothing about which pair was dealt first.
    expect(a.map((c) => c.photoUrl)).not.toEqual(b.map((c) => c.photoUrl));
  });

  it('never deals the two cards of a pair next to each other', () => {
    // A pair side by side is a game of no difficulty.
    for (const count of [2, 3, 4, 5, 6]) {
      const urls = Array.from({ length: count }, (_, i) => `${PHOTO}${i}`);
      const deck = buildMemoryDeck(payload(urls));
      const pos = positions(deck);
      for (let p = 0; p < count; p++) {
        const distance = Math.abs(pos[`${p}-a`] - pos[`${p}-b`]);
        expect(distance).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps each pair’s two cards on the same photo', () => {
    const deck = buildMemoryDeck(payload([`${PHOTO}1`, `${PHOTO}2`]));
    const byId = Object.fromEntries(deck.map((c) => [c.cardId, c.photoUrl]));
    expect(byId['0-a']).toBe(byId['0-b']);
    expect(byId['1-a']).toBe(byId['1-b']);
    expect(byId['0-a']).not.toBe(byId['1-a']);
  });
});
