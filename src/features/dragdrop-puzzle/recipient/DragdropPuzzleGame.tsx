'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DragdropPuzzlePayload } from '@/features/dragdrop-puzzle/schemas';

/**
 * DragdropPuzzleGame — recipient view (Phase 5, OOP-4221).
 *
 * Renders under /g/[token]/open when gifts.type === 'dragdrop_puzzle'.
 * The envelope page is generic; this component owns the recipient
 * experience for the type.
 *
 * Architecture §6 — feature module layout:
 *   src/features/dragdrop-puzzle/
 *     schemas.ts              ← shared Zod schema (already ships)
 *     recipient/              ← this file (entry)
 *
 * Game model:
 *   - The sender's photo is sliced into N×N cells (3 / 4 / 5).
 *   - Each piece P (correct slot = P) shows the same portion of the
 *     photo no matter where it sits — a CSS background-position swap.
 *   - On load the slots are Fisher–Yates shuffled so no piece starts
 *     in its correct slot.
 *   - On desktop the user drags pieces; on touch they tap two pieces
 *     to swap. The tap-to-swap path is also the keyboard fallback.
 *   - When every slot holds its correct piece, the reveal_message
 *     appears in a celebratory panel.
 */

function shuffledBoard(total: number): number[] {
  const ids = Array.from({ length: total }, (_, i) => i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  // Avoid the trivially-solved case.
  if (ids.every((p, i) => p === i)) {
    [ids[0], ids[1]] = [ids[1], ids[0]];
  }
  return ids;
}

export function DragdropPuzzleGame({
  payload,
  senderName,
}: {
  payload: DragdropPuzzlePayload;
  senderName: string;
}) {
  const t = useTranslations('Open.puzzle');

  const total = payload.grid * payload.grid;
  const [slots, setSlots] = useState<number[]>(() => shuffledBoard(total));
  const [selected, setSelected] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);

  // Reset the board when the payload changes (different share token).
  useEffect(() => {
    setSlots(shuffledBoard(total));
    setSelected(null);
    setMoves(0);
  }, [payload.photo_url, payload.grid, total]);

  const solved = useMemo(() => {
    if (slots.length === 0) return false;
    return slots.every((pieceId, slotIdx) => pieceId === slotIdx);
  }, [slots]);

  function swapPieces(a: number, b: number) {
    if (a === b) return;
    setSlots((prev) => {
      const next = [...prev];
      const ia = next.indexOf(a);
      const ib = next.indexOf(b);
      [next[ia], next[ib]] = [next[ib], next[ia]];
      return next;
    });
    setMoves((m) => m + 1);
  }

  // Tap-to-swap path. Works on touch + keyboard + mouse. The first tap
  // picks the piece, the second tap swaps it with the first.
  function handlePieceClick(pieceId: number) {
    if (solved) return;
    if (selected === null) {
      setSelected(pieceId);
      return;
    }
    if (selected === pieceId) {
      setSelected(null);
      return;
    }
    swapPieces(selected, pieceId);
    setSelected(null);
  }

  // HTML5 drag-and-drop path. Best-effort on desktop; mobile browsers
  // either fire synthetic drag events or fall through to the tap path.
  function handleDragStart(e: React.DragEvent, pieceId: number) {
    e.dataTransfer.setData('text/plain', String(pieceId));
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }
  function handleDrop(e: React.DragEvent, targetPieceId: number) {
    e.preventDefault();
    const raw = e.dataTransfer.getData('text/plain');
    const sourceId = Number(raw);
    if (Number.isNaN(sourceId) || sourceId === targetPieceId) return;
    swapPieces(sourceId, targetPieceId);
  }

  const correctCount = solved ? total : slots.filter((p, i) => p === i).length;

  return (
    <main className="lb-puzzle-page">
      <header className="lb-puzzle-page__head">
        <span className="lb-tag">{t('tag')}</span>
        <h1>{t('heading', { name: senderName })}</h1>
        <p className="lb-puzzle-page__progress">
          {solved
            ? t('progressDone', { total, moves })
            : t('progressPlaying', { correct: correctCount, total, moves })}
        </p>
      </header>

      <div
        className={`lb-puzzle-board lb-puzzle-board--g${payload.grid}`}
        role="grid"
        aria-label={t('boardAria')}
      >
        {slots.map((pieceId, slotIdx) => {
          const row = Math.floor(pieceId / payload.grid);
          const col = pieceId % payload.grid;
          const isSelected = selected === pieceId;
          const isCorrect = pieceId === slotIdx;
          // grid is 3|4|5 so (grid - 1) ∈ {2,3,4}; col/row ∈ [0, grid-1].
          const bgPos = `${(col * 100) / (payload.grid - 1)}% ${(row * 100) / (payload.grid - 1)}%`;
          return (
            <button
              key={slotIdx}
              type="button"
              role="gridcell"
              draggable={!solved}
              onDragStart={(e) => handleDragStart(e, pieceId)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, pieceId)}
              onClick={() => handlePieceClick(pieceId)}
              className={`lb-puzzle-piece${isSelected ? ' lb-puzzle-piece--selected' : ''}${isCorrect && !solved ? ' lb-puzzle-piece--correct' : ''}${solved ? ' lb-puzzle-piece--locked' : ''}`}
              aria-label={t('pieceAria', { n: slotIdx + 1 })}
              aria-pressed={isSelected}
              disabled={solved}
            >
              <span
                className="lb-puzzle-piece__image"
                style={{
                  backgroundImage: `url(${payload.photo_url})`,
                  backgroundPosition: bgPos,
                }}
              />
            </button>
          );
        })}
      </div>

      {solved && (
        <section className="lb-puzzle-page__win" role="status">
          <h2>{t('winHeading')}</h2>
          <p className="lb-puzzle-page__reveal">{payload.reveal_message}</p>
          <p className="lb-puzzle-page__moves">{t('winMoves', { moves })}</p>
        </section>
      )}
    </main>
  );
}