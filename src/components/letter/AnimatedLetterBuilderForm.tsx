'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  saveAnimatedLetterDraftAction,
  type SaveAnimatedLetterResult,
} from '@/lib/actions/animatedLetter';

/**
 * AnimatedLetterBuilderForm — sender-side form for the animated letter
 * gift type (OOP-6720).
 *
 * The recipient half of this format shipped in Phase 3; the sender half
 * did not, which left `animated_letter` — the create dropdown's default
 * — impossible to finish. This form is that missing half: the sender
 * writes the letter, picks the paper and the envelope colour, and saves.
 * `saveAnimatedLetterDraftAction` writes the gifts + shares rows; on
 * success we route to /create/[giftId]/finish?share=<token> where the
 * share link + PublishToMarketplaceCard both render.
 *
 * Text-only — the letter body, the paper style and the envelope colour.
 * Inline photos / voice notes are part of the payload schema but need
 * the upload pipeline, which is separate work.
 *
 * The length caps below mirror the schema in
 * `src/features/letter/schemas.ts`; the action re-validates, so they
 * are a courtesy to the sender, not the guard.
 */

const MAX_TITLE = 100;
const MAX_MARKDOWN = 5000;

const PAPERS = ['cream', 'kraft', 'lined'] as const;
const ENVELOPE_COLORS = ['honey', 'blush', 'sky'] as const;

type Paper = (typeof PAPERS)[number];
type EnvelopeColor = (typeof ENVELOPE_COLORS)[number];

export function AnimatedLetterBuilderForm() {
  const t = useTranslations('Builder.letter');
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [paper, setPaper] = useState<Paper>('cream');
  const [envelopeColor, setEnvelopeColor] = useState<EnvelopeColor>('honey');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (title.trim().length === 0) {
      setError(t('errors.titleRequired'));
      return;
    }
    if (markdown.trim().length === 0) {
      setError(t('errors.letterRequired'));
      return;
    }

    startSave(async () => {
      const result: SaveAnimatedLetterResult = await saveAnimatedLetterDraftAction({
        title: title.trim(),
        markdown: markdown.trim(),
        paper,
        envelope_color: envelopeColor,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/create/${result.giftId}/finish?share=${result.shareToken}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="lb-letter-builder">
      <div className="lb-field">
        <label htmlFor="letter-title">{t('titleLabel')}</label>
        <input
          id="letter-title"
          type="text"
          maxLength={MAX_TITLE}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('titlePlaceholder')}
          className="lb-input"
          required
        />
      </div>

      <div className="lb-field">
        <label htmlFor="letter-body">{t('letterLabel')}</label>
        <textarea
          id="letter-body"
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          maxLength={MAX_MARKDOWN}
          rows={12}
          placeholder={t('letterPlaceholder')}
          className="lb-textarea"
          required
        />
        <p className="lb-field-hint">
          {t('letterHint', { count: markdown.length, max: MAX_MARKDOWN })}
        </p>
      </div>

      <div className="lb-field">
        <label htmlFor="letter-paper">{t('paperLabel')}</label>
        <select
          id="letter-paper"
          className="lb-select"
          value={paper}
          onChange={(e) => setPaper(e.target.value as Paper)}
        >
          {PAPERS.map((p) => (
            <option key={p} value={p}>
              {t(`paper.${p}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="lb-field">
        <label htmlFor="letter-envelope">{t('envelopeLabel')}</label>
        <select
          id="letter-envelope"
          className="lb-select"
          value={envelopeColor}
          onChange={(e) => setEnvelopeColor(e.target.value as EnvelopeColor)}
        >
          {ENVELOPE_COLORS.map((c) => (
            <option key={c} value={c}>
              {t(`envelope.${c}`)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="lb-form__error">
          {error}
        </p>
      )}

      <button type="submit" className="lb-btn lb-btn--primary" disabled={isSaving}>
        {isSaving ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
