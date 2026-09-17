'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { createDraftGiftAction } from '@/lib/actions/draft';

const GIFT_TYPES = [
  { value: 'animated_letter', label: 'Animated letter' },
  { value: 'memory_cards', label: 'Memory cards' },
  { value: 'dragdrop_puzzle', label: 'Drag-and-drop puzzle' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'multimedia_collage', label: 'Multimedia collage' },
] as const;

/**
 * Minimal /create form (MVP, OOP-4893).
 *
 * Captures a title + gift type, calls createDraftGiftAction, then routes
 * to /create/[giftId]/finish where PublishToMarketplaceCard takes over.
 * Per-type builders (OOP-4219..4224) will replace this surface later.
 */
export function CreateDraftForm() {
  const t = useTranslations('Create');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<(typeof GIFT_TYPES)[number]['value']>(
    'animated_letter',
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createDraftGiftAction({ title, type });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Server action redirects, but on the rare path where it returned
      // ok without redirecting (e.g. anon), follow it client-side.
      router.push(`/create/${result.giftId}/finish`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="lb-form">
      <div className="lb-field">
        <label htmlFor="create-title">{t('titleLabel')}</label>
        <input
          id="create-title"
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
        <label htmlFor="create-type">{t('typeLabel')}</label>
        <select
          id="create-type"
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof GIFT_TYPES)[number]['value'])}
        >
          {GIFT_TYPES.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <small className="lb-field__hint">{t('typeHint')}</small>
      </div>

      {error && (
        <p role="alert" className="lb-form__error">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="lb-btn lb-btn--primary"
        disabled={isPending || title.trim().length === 0}
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
