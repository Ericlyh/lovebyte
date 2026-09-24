'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type {
  MultimediaCollagePayload,
  MultimediaMediaItem,
} from '@/lib/gifts/schemas';

/**
 * MultimediaCollageView — recipient view (Phase 7, OOP-4223).
 *
 * Renders under /g/[token]/open when gifts.type === 'multimedia_collage'.
 * The envelope page is generic; this component owns the recipient
 * experience for the type.
 *
 * Architecture §6 — feature module layout:
 *   src/features/multimedia-collage/
 *     schemas.ts              ← shared Zod schema (already ships)
 *     recipient/              ← this file (entry)
 *
 * Recipient experience:
 *   - The first paint shows the items in their canvas positions. Photos
 *     render immediately; videos + audios each have their own inline
 *     play control.
 *   - music_url (if present) renders a MusicToggle at the bottom that the
 *     recipient must tap before audio plays — Safari/iOS gate the autoplay
 *     on a user gesture, so we don't try to autoplay.
 *   - Captions (if present) overlay the item.
 *   - Unknown templates still render — we fall back to a 2-column flow
 *     anchored to the items' positions, so even if a future template id
 *     sneaks in, the recipient sees the items instead of a blank page.
 */

export function MultimediaCollageView({
  payload,
  senderName,
}: {
  payload: MultimediaCollagePayload;
  senderName: string;
}) {
  const t = useTranslations('Open.multimediaCollage');

  const [musicStarted, setMusicStarted] = useState(false);
  const [musicPaused, setMusicPaused] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset music state when the payload changes (different share token).
  useEffect(() => {
    setMusicStarted(false);
    setMusicPaused(false);
  }, [payload]);

  function handleMusicPlay() {
    const audio = audioRef.current;
    if (!audio) {
      setMusicStarted(true);
      setMusicPaused(false);
      return;
    }
    // Always pause-then-play on a user gesture so iOS Safari allows audio.
    audio.currentTime = 0;
    audio.play().catch(() => {/* gesture gate ignored — UI stays friendly */});
    setMusicStarted(true);
    setMusicPaused(false);
  }

  function handleMusicPause() {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setMusicPaused(true);
  }

  return (
    <main className="lb-multimedia-page">
      <article className="lb-multimedia">
        <header className="lb-multimedia__head">
          <span className="lb-tag">{t('tag')}</span>
          <p className="lb-multimedia__from">{t('fromLine', { name: senderName })}</p>
        </header>
        <h1 className="lb-multimedia__heading">{t('heading', { name: senderName })}</h1>
        <p className="lb-multimedia__lede">{t('lede')}</p>

        <div className={`lb-multimedia__canvas lb-multimedia__canvas--${payload.template}`}>
          {payload.media.map((item, idx) => (
            <CanvasMediaItem key={idx} item={item} index={idx} />
          ))}
        </div>

        {payload.music_url && (
          <div className="lb-multimedia__music">
            {!musicStarted && (
              <button
                type="button"
                className="lb-btn lb-btn--primary"
                onClick={handleMusicPlay}
              >
                {t('musicPlay')} 🎵
              </button>
            )}
            {musicStarted && !musicPaused && (
              <button
                type="button"
                className="lb-btn lb-btn--ghost"
                onClick={handleMusicPause}
              >
                {t('musicPause')} ⏸
              </button>
            )}
            {musicStarted && musicPaused && (
              <button
                type="button"
                className="lb-btn lb-btn--ghost"
                onClick={handleMusicPlay}
              >
                {t('musicPlay')} ▶
              </button>
            )}
            {/* Hidden audio element — autoplay only after the user gesture */}
            <audio
              ref={audioRef}
              src={payload.music_url}
              loop
              preload="none"
              style={{ display: 'none' }}
            />
          </div>
        )}
      </article>
    </main>
  );
}

function CanvasMediaItem({
  item,
  index,
}: {
  item: MultimediaMediaItem;
  index: number;
}) {
  const left = `${item.position.x * 100}%`;
  const top = `${item.position.y * 100}%`;
  const width = `${item.position.w * 100}%`;
  const height = `${item.position.h * 100}%`;

  return (
    <div
      className={`lb-multimedia__item lb-multimedia__item--${item.type}`}
      style={{ left, top, width, height }}
    >
      {item.type === 'photo' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt={item.caption ?? `Media item ${index + 1}`}
          className="lb-multimedia__media"
        />
      )}
      {item.type === 'video' && (
        <video
          src={item.url}
          controls
          playsInline
          preload="metadata"
          className="lb-multimedia__media"
          aria-label={item.caption ?? `Video ${index + 1}`}
        />
      )}
      {item.type === 'audio' && (
        <audio
          src={item.url}
          controls
          preload="metadata"
          className="lb-multimedia__media lb-multimedia__media--audio"
          aria-label={item.caption ?? `Audio ${index + 1}`}
        />
      )}
      {item.caption && item.type !== 'audio' && (
        <span className="lb-multimedia__caption">{item.caption}</span>
      )}
    </div>
  );
}
