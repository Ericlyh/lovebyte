'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  saveDragdropPuzzleDraftAction,
  type SaveDragdropPuzzleResult,
} from '@/lib/actions/dragdropPuzzle';

/**
 * DragdropPuzzleBuilderForm — sender-side form (Phase 5, OOP-4221).
 *
 * The sender uploads one photo, picks a grid size (3 / 4 / 5), and writes
 * a reveal message. On submit we POST the payload to
 * saveDragdropPuzzleDraftAction which writes gifts + shares rows. On
 * success the action returns the share token; we route to
 * /create/[giftId]/finish?share=<token> where the share link +
 * PublishToMarketplaceCard both render.
 *
 * Why client-managed? Photo uploads need progress + retry UX that
 * server actions don't model well. Keeping the upload as a fetch and
 * the save as an action matches the avatar + memory-cards pattern.
 */

const MAX_REVEAL_MESSAGE = 500;
const GRID_OPTIONS = [3, 4, 5] as const;

export function DragdropPuzzleBuilderForm() {
  const t = useTranslations('Builder.dragdropPuzzle');
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [grid, setGrid] = useState<3 | 4 | 5>(3);
  const [revealMessage, setRevealMessage] = useState('');
  const [photo, setPhoto] = useState<{
    mediaId: string;
    publicUrl: string;
    fileName: string;
  } | null>(null);
  const [photoStatus, setPhotoStatus] = useState<
    'idle' | 'uploading' | 'uploaded' | 'error'
  >('idle');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  async function handleFileChange(file: File) {
    setPhotoStatus('uploading');
    setPhotoError(null);
    setPhoto(null);

    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'dragdrop_puzzle');

    try {
      const res = await fetch('/api/upload/photo', { method: 'POST', body: form });
      const json = (await res.json()) as
        | { ok: true; mediaId: string; publicUrl: string }
        | { ok: false; error: string };
      if (!res.ok || !json.ok) {
        setPhotoStatus('error');
        setPhotoError('error' in json ? json.error : `HTTP ${res.status}`);
        return;
      }
      setPhoto({
        mediaId: json.mediaId,
        publicUrl: json.publicUrl,
        fileName: file.name,
      });
      setPhotoStatus('uploaded');
    } catch (e) {
      setPhotoStatus('error');
      setPhotoError(e instanceof Error ? e.message : 'Upload failed.');
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length === 0) {
      setError(t('errors.titleRequired'));
      return;
    }
    if (!photo) {
      setError(t('errors.photoRequired'));
      return;
    }
    if (photoStatus === 'uploading') {
      setError(t('errors.stillUploading'));
      return;
    }
    if (revealMessage.trim().length === 0) {
      setError(t('errors.revealRequired'));
      return;
    }

    const payload = {
      title: title.trim(),
      mediaId: photo.mediaId,
      grid,
      reveal_message: revealMessage.trim(),
    };

    startSave(async () => {
      const result: SaveDragdropPuzzleResult = await saveDragdropPuzzleDraftAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/create/${result.giftId}/finish?share=${result.shareToken}`);
    });
  }

  const pieceCount = grid * grid;

  return (
    <form onSubmit={handleSubmit} className="lb-form">
      <div className="lb-field">
        <label htmlFor="dp-title">{t('titleLabel')}</label>
        <input
          id="dp-title"
          name="title"
          type="text"
          maxLength={100}
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('titlePlaceholder')}
          autoFocus
        />
      </div>

      <div className="lb-field">
        <label>{t('photoLabel')}</label>
        <div className="lb-puzzle-upload">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo.publicUrl}
              alt={t('photoPreviewAlt')}
              className="lb-puzzle-upload__thumb"
            />
          ) : (
            <div className="lb-puzzle-upload__placeholder" aria-hidden="true">
              🧩
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileChange(file);
            }}
            aria-label={t('photoUploadAria')}
          />
          {photoStatus === 'uploading' && (
            <small className="lb-field__status lb-field__status--checking">
              {t('uploading')}
            </small>
          )}
          {photoStatus === 'error' && (
            <small className="lb-field__status lb-field__status--bad" role="alert">
              {photoError ?? t('uploadError')}
            </small>
          )}
          {photo && photoStatus === 'uploaded' && (
            <small className="lb-field__status lb-field__status--ok">
              {photo.fileName}
            </small>
          )}
        </div>
        <small className="lb-field__hint">{t('photoHint')}</small>
      </div>

      <div className="lb-field">
        <label htmlFor="dp-grid">{t('gridLabel')}</label>
        <select
          id="dp-grid"
          name="grid"
          value={grid}
          onChange={(e) => setGrid(Number(e.target.value) as 3 | 4 | 5)}
        >
          {GRID_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {t(`grid.${n}`)}
            </option>
          ))}
        </select>
        <small className="lb-field__hint">
          {t('gridHint', { pieces: pieceCount })}
        </small>
      </div>

      <div className="lb-field">
        <label htmlFor="dp-reveal">{t('revealLabel')}</label>
        <textarea
          id="dp-reveal"
          name="reveal_message"
          maxLength={MAX_REVEAL_MESSAGE}
          required
          rows={3}
          value={revealMessage}
          onChange={(e) => setRevealMessage(e.target.value)}
          placeholder={t('revealPlaceholder')}
        />
        <small className="lb-field__hint">
          {t('revealHint', {
            count: revealMessage.length,
            max: MAX_REVEAL_MESSAGE,
          })}
        </small>
      </div>

      {error && (
        <p className="lb-field__status lb-field__status--bad" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="lb-btn lb-btn--primary"
        disabled={isSaving}
      >
        {isSaving ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}