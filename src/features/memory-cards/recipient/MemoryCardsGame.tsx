'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MemoryCardsPayload } from '@/features/memory-cards/schemas';

/**
 * MemoryCardsGame — the flip-and-match recipient view (Phase 4, OOP-4219).
 *
 * Renders under /g/[token]/open when gifts.type === 'memory_cards'. The
 * envelope page is generic; this component owns the recipient
 * experience for the type.
 *
 * Architecture §6 — feature module layout:
 *   src/features/memory-cards/
 *     schemas.ts              ← shared Zod schema (already ships)
 *     recipient/              ← this file (entry)
 *     components/             ← reserved for the future Card/CardGrid/MatchedPairs
 *                               split. Today everything is in here; the
 *                               extraction happens when a second view
 *                               (e.g. live preview in the builder) needs it.
 *
 * Game model:
 *   - Deck = each pair produces two cards (different positions, same photo_url)
 *   - Click flips a card face-up
 *   - Two face-up cards with matching photo_url → matched (stay up, show caption)
 *   - Two face-up cards with different photo_url → unflip after a short delay
 *   - Game ends when every card is matched
 *
 * Music: the first flip counts as the user gesture that satisfies
 * Safari/iOS autoplay. If music_url is null, no audio.
 */

type Card = {
  /** Stable id per card instance (different positions in the same pair). */
  cardId: string;
  /** Photo URL — the matching key. Two cards share this when they're a pair. */
  photoUrl: string;
  caption: string;
};

type FlippedState = 'face-down' | 'face-up' | 'matched';

export function MemoryCardsGame({
  payload,
  senderName,
}: {
  payload: MemoryCardsPayload;
  senderName: string;
}) {
  const t = useTranslations('Open.memoryCards');

  // Build the deck once per payload. Stable order so React keys don't churn.
  const deck = useMemo<Card[]>(() => {
    const cards: Card[] = [];
    payload.pairs.forEach((pair, pairIdx) => {
      cards.push({
        cardId: `${pairIdx}-a`,
        photoUrl: pair.photo_url,
        caption: pair.caption,
      });
      cards.push({
        cardId: `${pairIdx}-b`,
        photoUrl: pair.photo_url,
        caption: pair.caption,
      });
    });
    // Shuffle deterministically on mount via Fisher–Yates. We don't need
    // crypto-strength randomness for a card game.
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }, [payload]);

  const [state, setState] = useState<FlippedState[]>(() =>
    deck.map(() => 'face-down'),
  );
  const [flippedIdx, setFlippedIdx] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [revealedCaption, setRevealedCaption] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lockRef = useRef(false);

  const totalPairs = payload.pairs.length;
  const matchedCount = state.filter((s) => s === 'matched').length / 2;
  const gameWon = matchedCount === totalPairs;

  // Reset flip-lock once two cards have settled.
  useEffect(() => {
    if (flippedIdx.length !== 2) return;
    lockRef.current = true;
    const [a, b] = flippedIdx;
    const isMatch = deck[a].photoUrl === deck[b].photoUrl;
    const delay = isMatch ? 600 : 1100;

    const timer = setTimeout(() => {
      setState((prev) => {
        const next = [...prev];
        if (isMatch) {
          next[a] = 'matched';
          next[b] = 'matched';
        } else {
          next[a] = 'face-down';
          next[b] = 'face-down';
        }
        return next;
      });
      setRevealedCaption(isMatch ? deck[a].caption : null);
      setFlippedIdx([]);
      lockRef.current = false;
    }, delay);

    return () => clearTimeout(timer);
  }, [flippedIdx, deck]);

  // Music: wait for the first flip so iOS Safari lets us autoplay.
  useEffect(() => {
    if (audioReady) return;
    if (!payload.music_url) return;
    if (moves === 0) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.5;
    audio.play().catch(() => {
      // Browser may still refuse. Quietly drop; the game itself
      // doesn't depend on audio.
    });
    setAudioReady(true);
  }, [moves, payload.music_url, audioReady]);

  function handleCardClick(idx: number) {
    if (lockRef.current) return;
    if (state[idx] !== 'face-down') return;
    if (flippedIdx.includes(idx)) return;
    if (flippedIdx.length >= 2) return;

    setState((prev) => {
      const next = [...prev];
      next[idx] = 'face-up';
      return next;
    });
    setFlippedIdx((prev) => {
      const next = [...prev, idx];
      if (next.length === 2) {
        setMoves((m) => m + 1);
      }
      return next;
    });
  }

  return (
    <main className="lb-memory-page">
      <header className="lb-memory-page__head">
        <span className="lb-tag">{t('tag')}</span>
        <h1>{t('heading', { name: senderName })}</h1>
        <p className="lb-memory-page__progress">
          {t('progress', {
            matched: matchedCount,
            total: totalPairs,
            moves,
          })}
        </p>
      </header>

      <ul
        className={`lb-memory-grid lb-memory-grid--${payload.difficulty}`}
        role="grid"
        aria-label={t('gridAria')}
      >
        {deck.map((card, idx) => {
          const cardState = state[idx];
          const showFront = cardState !== 'face-down';
          return (
            <li key={card.cardId} role="gridcell">
              <button
                type="button"
                className={`lb-memory-card lb-memory-card--${cardState}`}
                onClick={() => handleCardClick(idx)}
                aria-label={
                  showFront && cardState === 'matched'
                    ? t('matchedCardAria', { caption: card.caption })
                    : t('faceDownAria')
                }
                aria-pressed={showFront}
                disabled={cardState === 'matched'}
              >
                <span className="lb-memory-card__face lb-memory-card__face--back" aria-hidden="true">
                  {payload.card_back ? (
                    <span
                      className="lb-memory-card__back-image"
                      style={{ backgroundImage: `url(${payload.card_back})` }}
                    />
                  ) : (
                    <span className="lb-memory-card__back-fallback">♥</span>
                  )}
                </span>
                <span className="lb-memory-card__face lb-memory-card__face--front" aria-hidden={!showFront}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.photoUrl}
                    alt=""
                    className="lb-memory-card__photo"
                  />
                  {cardState === 'matched' && (
                    <span className="lb-memory-card__caption">{card.caption}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {revealedCaption && !gameWon && (
        <p className="lb-memory-page__caption-flash" aria-live="polite">
          {revealedCaption}
        </p>
      )}

      {gameWon && (
        <section className="lb-memory-page__win" role="status">
          <h2>{t('winHeading')}</h2>
          <p>{t('winBody', { moves })}</p>
        </section>
      )}

      {payload.music_url && (
        // Audio is created on demand. We mute → unmute once the first
        // flip has counted as a user gesture.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          ref={audioRef}
          src={payload.music_url}
          loop
          preload="none"
        />
      )}
    </main>
  );
}
