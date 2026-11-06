'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CatalogGift } from '@/lib/catalog';
import { composeCodeGiftDocument } from '@/lib/gifts/code-render';
import {
  AnimatedLetterPayloadSchema,
  CodeGiftPayloadSchema,
  DragdropPuzzlePayloadSchema,
  MemoryCardsPayloadSchema,
  MultimediaCollagePayloadSchema,
  QuizPayloadSchema,
} from '@/lib/gifts/schemas';
import { LetterView } from '@/features/letter/recipient/LetterView';
import { CodeGiftFrame } from '@/features/code/recipient/CodeGiftFrame';
import { MemoryCardsGame } from '@/features/memory-cards/recipient/MemoryCardsGame';
import { DragdropPuzzleGame } from '@/features/dragdrop-puzzle/recipient/DragdropPuzzleGame';
import { MultimediaCollageView } from '@/features/multimedia-collage/recipient/MultimediaCollageView';
import { QuizGame } from '@/features/quiz/recipient/QuizGame';

/**
 * The catalogue preview (OOP-7451).
 *
 * "Make people can browse AND PREVIEW the gift when people browse the
 * gift" — so a visitor in /browse can open a listing's gift and play
 * with it before they click through.
 *
 * ## It is the real gift, not a picture of one
 *
 * The preview renders the SAME components the recipient plays with at
 * `/g/[token]/open` — the same quiz game, the same card grid, the same
 * letter. A preview drawn from scratch would drift from the real thing
 * the moment either changed, and a preview that lies about what the
 * gift does is worse than no preview at all.
 *
 * Two things are deliberately NOT the real thing:
 *
 *   - the write-back composer (the browser of a catalogue is not the
 *     recipient), and
 *   - the tracking (a preview is not an open — the open counter lives
 *     on `/g/[token]/open` and must not be inflated by browsing).
 *
 * The letter is the one gift whose recipient render is a SERVER
 * component (the recipient should read it in the first paint), so the
 * markup it shares with the preview lives in `LetterView` — see there.
 *
 * ## Why the content is fetched on demand
 *
 * The catalogue feed deliberately does not carry the payload — a code
 * gift's payload is up to 200 KB. The preview fetches this one gift's
 * payload from `/api/catalog/preview/[giftId]` when the visitor asks
 * for it.
 */
type Props = {
  /** The listing being previewed. */
  gift: CatalogGift;
  /** Called when the visitor closes the preview. */
  onClose: () => void;
};

type PreviewState =
  | { status: 'loading' }
  | { status: 'error' }
  | {
      status: 'ready';
      type: string;
      payload: unknown;
      senderName: string;
      kind: string | null;
    };

export function GiftPreviewDialog({ gift, onClose }: Props) {
  const t = useTranslations('Catalog.preview');
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Remember what had focus before the preview opened, so closing it
  // puts the visitor back on the button they pressed.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // The portal target is `document.body`, which does not exist during
  // the server render — the dialog is client-only, so it mounts after.
  useEffect(() => {
    setMounted(true);
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  // Fetch this gift's payload.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    fetch(`/api/catalog/preview/${gift.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`preview failed: ${res.status}`);
        return (await res.json()) as {
          gift: { type: string; payload: unknown; senderName: string; kind: string | null };
        };
      })
      .then((data) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          type: data.gift.type,
          payload: data.gift.payload,
          senderName: data.gift.senderName,
          kind: data.gift.kind,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [gift.id]);

  // Escape closes the preview. The listener is on the document so it
  // works no matter where focus is inside the panel.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // The page behind the preview must not scroll while it is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // Move focus into the panel when it opens, so a keyboard visitor is
  // not left behind the modal on the page underneath.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!mounted) return null;

  return createPortal(
    <div className="lb-preview" onClick={onBackdropClick}>
      <div
        className="lb-preview__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lb-preview-title"
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="lb-preview__head">
          <div className="lb-preview__heading">
            <p className="lb-preview__eyebrow">{t('tag')}</p>
            <h2 className="lb-preview__title" id="lb-preview-title">
              {gift.title}
            </h2>
          </div>
          <button
            type="button"
            className="lb-preview__close"
            onClick={onClose}
            aria-label={t('close')}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="lb-preview__frame">
          {state.status === 'loading' ? (
            <p className="lb-preview__note" role="status">
              {t('loading')}
            </p>
          ) : state.status === 'error' ? (
            <p className="lb-preview__note" role="alert">
              {t('error')}
            </p>
          ) : (
            <GiftPreviewBody
              type={state.type}
              payload={state.payload}
              senderName={state.senderName}
            />
          )}
        </div>

        <footer className="lb-preview__foot">
          <Link href={`/l/${gift.id}`} className="lb-btn lb-btn--ghost">
            {t('openFull')}
          </Link>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The gift itself, rendered by the component the recipient plays with.
 *
 * Each branch narrows the payload through its Zod schema first — the
 * payload is JSONB from the database, so it is untrusted input. A
 * payload that does not match its schema renders the "cannot preview"
 * note rather than a broken game.
 */
function GiftPreviewBody({
  type,
  payload,
  senderName,
}: {
  type: string;
  payload: unknown;
  senderName: string;
}) {
  const t = useTranslations('Catalog.preview');
  const tOpen = useTranslations('Open');

  if (type === 'quiz') {
    const parsed = QuizPayloadSchema.safeParse(payload);
    if (!parsed.success) return <p className="lb-preview__note">{t('unavailable')}</p>;
    return <QuizGame payload={parsed.data} senderName={senderName} />;
  }

  if (type === 'memory_cards') {
    const parsed = MemoryCardsPayloadSchema.safeParse(payload);
    if (!parsed.success) return <p className="lb-preview__note">{t('unavailable')}</p>;
    return (
      <MemoryCardsGame
        payload={parsed.data}
        senderName={senderName}
        giftId={null}
        nextPath=""
        showWriteBack={false}
      />
    );
  }

  if (type === 'dragdrop_puzzle') {
    const parsed = DragdropPuzzlePayloadSchema.safeParse(payload);
    if (!parsed.success) return <p className="lb-preview__note">{t('unavailable')}</p>;
    return <DragdropPuzzleGame payload={parsed.data} senderName={senderName} />;
  }

  if (type === 'multimedia_collage') {
    const parsed = MultimediaCollagePayloadSchema.safeParse(payload);
    if (!parsed.success) return <p className="lb-preview__note">{t('unavailable')}</p>;
    return <MultimediaCollageView payload={parsed.data} senderName={senderName} />;
  }

  if (type === 'animated_letter') {
    const parsed = AnimatedLetterPayloadSchema.safeParse(payload);
    if (!parsed.success) return <p className="lb-preview__note">{t('unavailable')}</p>;
    return (
      <main className="lb-letter-page">
        <LetterView
          letter={parsed.data}
          tag={tOpen('letterTag')}
          fromLine={tOpen('fromLine', { name: senderName })}
          foot={tOpen('letterFoot')}
        />
      </main>
    );
  }

  if (type === 'code') {
    const parsed = CodeGiftPayloadSchema.safeParse(payload);
    if (!parsed.success) return <p className="lb-preview__note">{t('unavailable')}</p>;
    return (
      <main className="lb-code-page">
        <CodeGiftFrame
          document={composeCodeGiftDocument(parsed.data)}
          title={tOpen('codeFrameTitle')}
        />
      </main>
    );
  }

  return <p className="lb-preview__note">{t('unavailable')}</p>;
}
