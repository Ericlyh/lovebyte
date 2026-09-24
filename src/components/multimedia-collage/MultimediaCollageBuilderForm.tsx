'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  saveMultimediaCollageDraftAction,
  type SaveMultimediaCollageResult,
} from '@/lib/actions/multimediaCollage';

/**
 * MultimediaCollageBuilderForm — sender-side form (Phase 7, OOP-4223).
 *
 * The sender uploads 1–20 media items (mixed photos / videos / audios via
 * /api/upload/media), drags them onto a canvas, and the recipient opens
 * the collage at /g/[token].
 *
 * Canvas model:
 *   - The canvas is a 1000×600 (4:3-ish) coordinate space that the builder
 *     drag-translates into 0..1 percentage positions before saving.
 *   - Each item has {x, y, w, h} in 0..1 percentages — they stretch on
 *     the recipient side regardless of viewport size.
 *   - The sender picks one of three templates (polaroid-wall, timeline,
 *     magazine); each template seeds item positions so the canvas isn't
 *     empty to start. The template choice is stored verbatim in the
 *     payload — the recipient renders with a sensible default for unknown
 *     templates.
 *
 * Drag-to-place UX:
 *   - Pointerdown on an item handle → start drag (deltaX/Y tracked against
 *     pointermove, clamped inside the canvas).
 *   - Pointerdown on an item body → select the item; the "swap" mode is
 *     toggled by clicking two items in succession (accessibility escape
 *     hatch). The keyboard path is via the swap button on the selected
 *     item's toolbar.
 *
 * Save flow mirrors Phase 4 (memory-cards): the form posts the JSON to
 * saveMultimediaCollageDraftAction which resolves mediaIds → public URLs
 * and writes gifts + shares rows.
 */

type ItemType = 'photo' | 'video' | 'audio';

type MediaItem = {
  clientId: string;
  mediaId: string | null;
  type: ItemType;
  /** Public URL for live preview. */
  publicUrl: string | null;
  caption: string;
  /** Position in 0..1 percentages of the canvas. */
  position: { x: number; y: number; w: number; h: number };
  status: 'idle' | 'uploading' | 'uploaded' | 'error';
  error: string | null;
  fileName: string | null;
};

const ACCEPT_BY_KIND: Record<ItemType, string> = {
  photo: 'image/png,image/jpeg,image/webp',
  video: 'video/mp4,video/webm,video/quicktime',
  audio: 'audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/x-m4a',
};

const MAX_ITEMS = 20;
const MIN_ITEMS = 1;
const CANVAS_W = 1000;
const CANVAS_H = 600;

// ─── templates ────────────────────────────────────────────────────────────
// Templates are stored as position grids; the sender sees a small preview
// palette. Unknown templates still render on the recipient side (the
// recipient renderer uses a default 2-column flow for safety).
type Slot = { x: number; y: number; w: number; h: number };

const TEMPLATES: Record<string, { name: string; rows: Slot[] }> = {
  'polaroid-wall': {
    name: 'Polaroid wall',
    rows: [
      { x: 0.04, y: 0.05, w: 0.28, h: 0.42 },
      { x: 0.36, y: 0.08, w: 0.28, h: 0.42 },
      { x: 0.68, y: 0.05, w: 0.28, h: 0.42 },
      { x: 0.18, y: 0.52, w: 0.28, h: 0.42 },
      { x: 0.5, y: 0.55, w: 0.28, h: 0.42 },
    ],
  },
  timeline: {
    name: 'Timeline',
    rows: [
      { x: 0.04, y: 0.1, w: 0.18, h: 0.32 },
      { x: 0.26, y: 0.1, w: 0.18, h: 0.32 },
      { x: 0.48, y: 0.1, w: 0.18, h: 0.32 },
      { x: 0.7, y: 0.1, w: 0.18, h: 0.32 },
      { x: 0.18, y: 0.5, w: 0.18, h: 0.32 },
      { x: 0.4, y: 0.5, w: 0.18, h: 0.32 },
      { x: 0.62, y: 0.5, w: 0.18, h: 0.32 },
    ],
  },
  magazine: {
    name: 'Magazine',
    rows: [
      { x: 0.32, y: 0.04, w: 0.36, h: 0.45 },
      { x: 0.04, y: 0.04, w: 0.25, h: 0.45 },
      { x: 0.71, y: 0.04, w: 0.25, h: 0.45 },
      { x: 0.04, y: 0.55, w: 0.45, h: 0.4 },
      { x: 0.52, y: 0.55, w: 0.44, h: 0.4 },
    ],
  },
};

const DEFAULT_TEMPLATE: keyof typeof TEMPLATES = 'polaroid-wall';

function blankItem(): MediaItem {
  return {
    clientId: crypto.randomUUID(),
    mediaId: null,
    type: 'photo',
    publicUrl: null,
    caption: '',
    position: { x: 0, y: 0, w: 0.3, h: 0.4 },
    status: 'idle',
    error: null,
    fileName: null,
  };
}

function itemAtSlot(slotIndex: number, templateKey: string): MediaItem {
  const tpl = TEMPLATES[templateKey] ?? TEMPLATES[DEFAULT_TEMPLATE];
  const slot = tpl.rows[slotIndex % tpl.rows.length];
  return {
    ...blankItem(),
    position: { ...slot },
  };
}

export function MultimediaCollageBuilderForm() {
  const t = useTranslations('Builder.multimediaCollage');
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [templateKey, setTemplateKey] = useState<string>(DEFAULT_TEMPLATE);
  const [items, setItems] = useState<MediaItem[]>(() =>
    Array.from({ length: 3 }, (_, i) => itemAtSlot(i, DEFAULT_TEMPLATE)),
  );
  const [musicUrl, setMusicUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();
  /** Non-null when the user has selected an item (for the swap action). */
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  function updateItem(clientId: string, patch: Partial<MediaItem>) {
    setItems((prev) =>
      prev.map((it) => (it.clientId === clientId ? { ...it, ...patch } : it)),
    );
  }

  async function handleFileChange(clientId: string, file: File) {
    const kind: ItemType =
      file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : 'photo';

    updateItem(clientId, {
      status: 'uploading',
      error: null,
      fileName: file.name,
      mediaId: null,
      publicUrl: null,
      type: kind,
    });

    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);

    try {
      const res = await fetch('/api/upload/media', {
        method: 'POST',
        body: form,
      });
      const json = (await res.json()) as
        | { ok: true; mediaId: string; publicUrl: string; kind: ItemType }
        | { ok: false; error: string };
      if (!res.ok || !json.ok) {
        updateItem(clientId, {
          status: 'error',
          error: 'error' in json ? json.error : `HTTP ${res.status}`,
        });
        return;
      }
      updateItem(clientId, {
        status: 'uploaded',
        mediaId: json.mediaId,
        publicUrl: json.publicUrl,
        type: json.kind,
        error: null,
      });
    } catch (e) {
      updateItem(clientId, {
        status: 'error',
        error: e instanceof Error ? e.message : 'Upload failed.',
      });
    }
  }

  function addItem() {
    if (items.length >= MAX_ITEMS) return;
    setItems((prev) => [...prev, itemAtSlot(prev.length, templateKey)]);
  }

  function removeItem(clientId: string) {
    if (items.length <= MIN_ITEMS) return;
    setItems((prev) => prev.filter((it) => it.clientId !== clientId));
    if (selectedClientId === clientId) setSelectedClientId(null);
  }

  function applyTemplate(key: string) {
    setTemplateKey(key);
    const tpl = TEMPLATES[key] ?? TEMPLATES[DEFAULT_TEMPLATE];
    // Re-snap items to the new template positions in order; extra items
    // sit in the first slot, very-extra items get hidden behind a tall
    // bottom row.
    setItems((prev) =>
      prev.map((it, i) => {
        const slot = tpl.rows[i] ?? tpl.rows[tpl.rows.length - 1];
        return { ...it, position: { ...slot } };
      }),
    );
  }

  /** Pointer-driven drag for items on the canvas. */
  function handleItemDragStart(
    e: React.PointerEvent<HTMLDivElement>,
    clientId: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const item = items.find((it) => it.clientId === clientId);
    if (!item) return;
    const startPos = { ...item.position };

    function onMove(ev: PointerEvent) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // Convert pixel delta → 0..1 delta using the live rendered size.
      const dxPct = (ev.clientX - startX) / rect.width;
      const dyPct = (ev.clientY - startY) / rect.height;
      const newX = Math.min(
        1 - startPos.w,
        Math.max(0, startPos.x + dxPct),
      );
      const newY = Math.min(
        1 - startPos.h,
        Math.max(0, startPos.y + dyPct),
      );
      updateItem(clientId, {
        position: { ...startPos, x: newX, y: newY },
      });
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function selectForSwap(clientId: string) {
    if (selectedClientId == null) {
      setSelectedClientId(clientId);
      return;
    }
    if (selectedClientId === clientId) {
      setSelectedClientId(null);
      return;
    }
    // Swap the two items (positions + caption; media ids stay attached
    // to the layout so the preview URLs move with them).
    const a = selectedClientId;
    const b = clientId;
    setItems((prev) => {
      const ai = prev.find((it) => it.clientId === a);
      const bi = prev.find((it) => it.clientId === b);
      if (!ai || !bi) return prev;
      return prev.map((it) => {
        if (it.clientId === a) {
          return { ...it, position: { ...bi.position }, caption: bi.caption };
        }
        if (it.clientId === b) {
          return { ...it, position: { ...ai.position }, caption: ai.caption };
        }
        return it;
      });
    });
    setSelectedClientId(null);
  }

  // ─── validation + submit ────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length === 0) {
      setError(t('errors.titleRequired'));
      return;
    }
    const readyItems = items.filter(
      (it) =>
        it.status === 'uploaded' && it.mediaId !== null && it.publicUrl !== null,
    );
    if (readyItems.length < MIN_ITEMS) {
      setError(t('errors.notEnoughMedia', { min: MIN_ITEMS }));
      return;
    }
    if (readyItems.length > MAX_ITEMS) {
      setError(t('errors.tooManyMedia', { max: MAX_ITEMS }));
      return;
    }
    if (items.some((it) => it.status === 'uploading')) {
      setError(t('errors.stillUploading'));
      return;
    }

    const payload = {
      title: title.trim(),
      template: templateKey,
      mediaItems: readyItems.map((it) => ({
        clientId: it.clientId,
        mediaId: it.mediaId!,
        type: it.type,
        caption: it.caption.trim(),
        position: it.position,
      })),
      musicUrl: musicUrl.trim().length > 0 ? musicUrl.trim() : '',
    };

    startSave(async () => {
      const result: SaveMultimediaCollageResult =
        await saveMultimediaCollageDraftAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/create/${result.giftId}/finish?share=${result.shareToken}`);
    });
  }

  const readyItems = items.filter((it) => it.status === 'uploaded');
  const canAdd = items.length < MAX_ITEMS;
  const canRemove = items.length > MIN_ITEMS;

  // Esc cancels swap mode (keyboard escape hatch).
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && selectedClientId !== null) {
        setSelectedClientId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedClientId]);

  return (
    <form onSubmit={handleSubmit} className="lb-form lb-multimedia-collage">
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
          className="lb-input"
          autoFocus
        />
      </div>

      <div className="lb-field">
        <label htmlFor="mc-template">{t('templateLabel')}</label>
        <select
          id="mc-template"
          name="template"
          value={templateKey}
          onChange={(e) => applyTemplate(e.target.value)}
          className="lb-input"
        >
          {Object.entries(TEMPLATES).map(([key, tpl]) => (
            <option key={key} value={key}>
              {tpl.name}
            </option>
          ))}
        </select>
        <small className="lb-field-hint">{t('templateHint')}</small>
      </div>

      <div className="lb-multimedia-collage__canvas-wrap">
        <p className="lb-multimedia-collage__canvas-label">
          {t('canvasLabel')}
        </p>

        <div
          ref={canvasRef}
          className="lb-multimedia-collage__canvas"
          style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          onClick={() => setSelectedClientId(null)}
        >
          {items.map((it, idx) => {
            const left = `${it.position.x * 100}%`;
            const top = `${it.position.y * 100}%`;
            const width = `${it.position.w * 100}%`;
            const height = `${it.position.h * 100}%`;
            const isSelected = it.clientId === selectedClientId;
            return (
              <div
                key={it.clientId}
                className={`lb-multimedia-collage__slot ${isSelected ? 'lb-multimedia-collage__slot--selected' : ''}`}
                style={{ left, top, width, height }}
                role="group"
                aria-label={
                  it.status === 'uploaded'
                    ? t('slotAriaFilled', { n: idx + 1, type: t(`type.${it.type}`) })
                    : t('slotAriaEmpty', { n: idx + 1 })
                }
              >
                {it.publicUrl ? (
                  <Preview type={it.type} url={it.publicUrl} />
                ) : (
                  <div className="lb-multimedia-collage__placeholder" aria-hidden="true">
                    📷
                  </div>
                )}

                <div
                  className="lb-multimedia-collage__slot-handle"
                  onPointerDown={(e) => handleItemDragStart(e, it.clientId)}
                  aria-hidden="true"
                />

                {it.status === 'uploading' && (
                  <small className="lb-multimedia-collage__status lb-multimedia-collage__status--busy">
                    {t('uploading')}
                  </small>
                )}
                {it.status === 'error' && (
                  <small
                    className="lb-multimedia-collage__status lb-multimedia-collage__status--bad"
                    role="alert"
                  >
                    {it.error ?? t('uploadError')}
                  </small>
                )}

                <div className="lb-multimedia-collage__slot-actions">
                  <label className="lb-multimedia-collage__upload-btn">
                    <input
                      type="file"
                      accept={ACCEPT_BY_KIND[it.type]}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileChange(it.clientId, file);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={
                        it.status === 'uploaded'
                          ? t('slotAriaFilled', {
                              n: idx + 1,
                              type: t(`type.${it.type}`),
                            })
                          : t('slotAriaEmpty', { n: idx + 1 })
                      }
                    />
                    📎
                  </label>
                  <button
                    type="button"
                    className="lb-multimedia-collage__swap-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectForSwap(it.clientId);
                    }}
                    aria-label={`Swap slot ${idx + 1}`}
                  >
                    ⇄
                  </button>
                  {canRemove && (
                    <button
                      type="button"
                      className="lb-multimedia-collage__remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(it.clientId);
                      }}
                      aria-label={t('removeSlotAria', { n: idx + 1 })}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Caption lives inside the canvas so it lines up with the item
                    on the recipient side. */}
                {it.type !== 'audio' && (
                  <input
                    type="text"
                    className="lb-multimedia-collage__caption"
                    value={it.caption}
                    onChange={(e) =>
                      updateItem(it.clientId, { caption: e.target.value })
                    }
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    maxLength={200}
                    placeholder={t('captionPlaceholder')}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="lb-field-hint">
          {t('canvasHint', {
            count: readyItems.length,
            min: MIN_ITEMS,
            max: MAX_ITEMS,
          })}
        </p>

        {selectedClientId !== null && (
          <p className="lb-multimedia-collage__swap-hint" role="status">
            {t('swapHint')}
          </p>
        )}

        {canAdd && (
          <button
            type="button"
            className="lb-btn lb-btn--ghost"
            onClick={addItem}
          >
            + {t('addMedia')}
          </button>
        )}
      </div>

      <div className="lb-field">
        <label htmlFor="mc-music">{t('musicLabel')}</label>
        <input
          id="mc-music"
          name="music_url"
          type="url"
          value={musicUrl}
          onChange={(e) => setMusicUrl(e.target.value)}
          placeholder="https://example.com/your-song.mp3"
          className="lb-input"
        />
        <small className="lb-field-hint">{t('musicHint')}</small>
      </div>

      {error && (
        <p className="lb-form-error" role="alert">
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

function Preview({ type, url }: { type: ItemType; url: string }) {
  if (type === 'photo') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="lb-multimedia-collage__media" />;
  }
  if (type === 'video') {
    return (
      <video
        src={url}
        muted
        playsInline
        controls
        className="lb-multimedia-collage__media"
        // For the builder preview we don't need playback — the recipient
        // page mounts the real <video> with autoplay policies. Builder
        // just verifies the upload rendered correctly.
        preload="metadata"
      />
    );
  }
  return (
    <div className="lb-multimedia-collage__media lb-multimedia-collage__media--audio" aria-hidden="true">
      🎵
    </div>
  );
}
