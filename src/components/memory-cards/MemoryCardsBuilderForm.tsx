'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  saveMemoryCardsDraftAction,
  type SaveMemoryCardsResult,
} from '@/lib/actions/memoryCards';

/**
 * MemoryCardsBuilderForm — sender-side form (Phase 4, OOP-4219).
 *
 * The sender adds 3–12 photo pairs. For each pair:
 *   1. They pick a file → POST /api/upload/photo?kind=memory_cards
 *   2. We store the returned mediaId + publicUrl
 *   3. They write a short caption that the recipient reads after match
 *
 * On submit we POST the full payload to saveMemoryCardsDraftAction
 * which writes the gifts + shares rows. On success the action returns
 * the share token; we route to /create/[giftId]/finish?share=<token>
 * where the share link + PublishToMarketplaceCard both render.
 *
 * Why client-managed? Photo uploads need progress + retry UX that
 * server actions don't model well. Keeping the upload as a fetch and
 * the save as an action matches the avatar route's split.
 */

type PairState = {
  /** Stable client id for React keys (not sent to the server). */
  clientId: string;
  /** Uploaded media id from /api/upload/photo. */
  mediaId: string | null;
  /** Public URL for the live preview thumbnail. */
  publicUrl: string | null;
  /** Caption the sender writes for this pair. */
  caption: string;
  /** Per-pair upload status. */
  status: 'idle' | 'uploading' | 'uploaded' | 'error';
  /** Error message if status === 'error'. */
  error: string | null;
  /** Local-only: the File blob so the user can re-pick without re-uploading. */
  fileName: string | null;
};

const EMPTY_PAIR: Omit<PairState, 'clientId'> = {
  mediaId: null,
  publicUrl: null,
  caption: '',
  status: 'idle',
  error: null,
  fileName: null,
};

function makePair(): PairState {
  return { ...EMPTY_PAIR, clientId: crypto.randomUUID() };
}

const MIN_PAIRS = 3;
const MAX_PAIRS = 12;

export function MemoryCardsBuilderForm() {
  const t = useTranslations('Builder.memoryCards');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [musicUrl, setMusicUrl] = useState('');
  const [pairs, setPairs] = useState<PairState[]>(() =>
    Array.from({ length: MIN_PAIRS }, () => makePair()),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function updatePair(clientId: string, patch: Partial<PairState>) {
    setPairs((prev) =>
      prev.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p)),
    );
  }

  async function handleFileChange(clientId: string, file: File) {
    updatePair(clientId, {
      status: 'uploading',
      error: null,
      fileName: file.name,
      mediaId: null,
      publicUrl: null,
    });

    const form = new FormData();
    form.append('file', file);
    form.append('kind', 'memory_cards');

    try {
      const res = await fetch('/api/upload/photo', { method: 'POST', body: form });
      const json = (await res.json()) as
        | { ok: true; mediaId: string; publicUrl: string }
        | { ok: false; error: string };
      if (!res.ok || !json.ok) {
        updatePair(clientId, {
          status: 'error',
          error: 'error' in json ? json.error : `HTTP ${res.status}`,
        });
        return;
      }
      updatePair(clientId, {
        status: 'uploaded',
        mediaId: json.mediaId,
        publicUrl: json.publicUrl,
        error: null,
      });
    } catch (e) {
      updatePair(clientId, {
        status: 'error',
        error: e instanceof Error ? e.message : 'Upload failed.',
      });
    }
  }

  function addPair() {
    if (pairs.length >= MAX_PAIRS) return;
    setPairs((prev) => [...prev, makePair()]);
  }

  function removePair(clientId: string) {
    if (pairs.length <= MIN_PAIRS) return;
    setPairs((prev) => prev.filter((p) => p.clientId !== clientId));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Local validation — the server re-validates but a friendly client
    // message beats a 500 from Zod.
    if (title.trim().length === 0) {
      setError(t('errors.titleRequired'));
      return;
    }
    const readyPairs = pairs.filter(
      (p) => p.status === 'uploaded' && p.mediaId && p.caption.trim().length > 0,
    );
    if (readyPairs.length < MIN_PAIRS) {
      setError(t('errors.notEnoughPairs', { min: MIN_PAIRS }));
      return;
    }
    if (readyPairs.length > MAX_PAIRS) {
      setError(t('errors.tooManyPairs', { max: MAX_PAIRS }));
      return;
    }
    if (pairs.some((p) => p.status === 'uploading')) {
      setError(t('errors.stillUploading'));
      return;
    }

    const payload = {
      title: title.trim(),
      pairs: readyPairs.map((p) => ({
        mediaId: p.mediaId!,
        caption: p.caption.trim(),
      })),
      difficulty,
      music_url: musicUrl.trim().length > 0 ? musicUrl.trim() : null,
    };

    startSave(async () => {
      const result: SaveMemoryCardsResult = await saveMemoryCardsDraftAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/create/${result.giftId}/finish?share=${result.shareToken}`);
    });
  }

  const canAdd = pairs.length < MAX_PAIRS;
  const canRemove = pairs.length > MIN_PAIRS;

  return (
    <form onSubmit={handleSubmit} className="lb-form">
      <div className="lb-field">
        <label htmlFor="mc-title">{t('titleLabel')}</label>
        <input
          id="mc-title"
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
        <label htmlFor="mc-difficulty">{t('difficultyLabel')}</label>
        <select
          id="mc-difficulty"
          name="difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as 'easy' | 'medium' | 'hard')}
        >
          <option value="easy">{t('difficulty.easy')}</option>
          <option value="medium">{t('difficulty.medium')}</option>
          <option value="hard">{t('difficulty.hard')}</option>
        </select>
        <small className="lb-field__hint">{t('difficultyHint')}</small>
      </div>

      <div className="lb-form__section-heading">
        {t('pairsHeading')} <small>({pairs.length}/{MAX_PAIRS})</small>
      </div>

      {pairs.map((pair, idx) => (
        <PairRow
          key={pair.clientId}
          index={idx}
          pair={pair}
          onFile={(file) => handleFileChange(pair.clientId, file)}
          onCaption={(caption) => updatePair(pair.clientId, { caption })}
          onRemove={canRemove ? () => removePair(pair.clientId) : undefined}
        />
      ))}

      {canAdd && (
        <button
          type="button"
          className="lb-btn lb-btn--ghost lb-btn--sm"
          onClick={addPair}
        >
          {t('addPair')}
        </button>
      )}

      <div className="lb-field">
        <label htmlFor="mc-music">{t('musicLabel')}</label>
        <input
          id="mc-music"
          name="music_url"
          type="url"
          value={musicUrl}
          onChange={(e) => setMusicUrl(e.target.value)}
          placeholder={t('musicPlaceholder')}
        />
        <small className="lb-field__hint">{t('musicHint')}</small>
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

function PairRow({
  index,
  pair,
  onFile,
  onCaption,
  onRemove,
}: {
  index: number;
  pair: PairState;
  onFile: (file: File) => void;
  onCaption: (caption: string) => void;
  onRemove: (() => void) | undefined;
}) {
  const t = useTranslations('Builder.memoryCards.pair');
  return (
    <fieldset className="lb-card lb-memory-pair">
      <legend>
        {t('legend', { n: index + 1 })}
      </legend>

      <div className="lb-memory-pair__upload">
        {pair.publicUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pair.publicUrl}
            alt={pair.caption || t('pairPreviewAlt')}
            className="lb-memory-pair__thumb"
          />
        ) : (
          <div className="lb-memory-pair__placeholder" aria-hidden="true">
            📷
          </div>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
          aria-label={t('uploadAria', { n: index + 1 })}
        />
        {pair.status === 'uploading' && (
          <small className="lb-field__status lb-field__status--checking">
            {t('uploading')}
          </small>
        )}
        {pair.status === 'error' && (
          <small className="lb-field__status lb-field__status--bad" role="alert">
            {pair.error ?? t('uploadError')}
          </small>
        )}
        {pair.fileName && pair.status === 'uploaded' && (
          <small className="lb-field__status lb-field__status--ok">
            {pair.fileName}
          </small>
        )}
      </div>

      <div className="lb-memory-pair__caption">
        <label htmlFor={`mc-cap-${pair.clientId}`}>{t('captionLabel')}</label>
        <input
          id={`mc-cap-${pair.clientId}`}
          type="text"
          maxLength={120}
          value={pair.caption}
          onChange={(e) => onCaption(e.target.value)}
          placeholder={t('captionPlaceholder')}
        />
      </div>

      {onRemove && (
        <button
          type="button"
          className="lb-btn lb-btn--ghost lb-btn--sm lb-memory-pair__remove"
          onClick={onRemove}
          aria-label={t('removeAria', { n: index + 1 })}
        >
          {t('remove')}
        </button>
      )}
    </fieldset>
  );
}
