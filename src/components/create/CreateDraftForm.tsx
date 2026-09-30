'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { createDraftGiftAction, type CreateDraftGiftResult } from '@/lib/actions/draft';

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
 * Wired to `createDraftGiftAction` via `useActionState` — the same pattern
 * the rest of the marketplace forms use (LoginForm, WaitlistForm,
 * ResendConfirmationForm, ProfileEditForm, all builder forms). The action
 * does its own validation and `redirect()` on success; on failure it
 * returns `{ ok: false, error }` which we render below the button.
 *
 * Why useActionState + form action (and not the older useTransition +
 * onSubmit pattern that lived here previously): when invoked via
 * `await createDraftGiftAction(...)` inside `startTransition`, the
 * action's `redirect()` throw is silently swallowed — the `await`
 * never resolves and the browser never navigates, which surfaces to the
 * user as "button does nothing" (OOP-5432). The `<form action={action}>`
 * pattern hands the response to Next.js's form-submission machinery,
 * which honours `redirect()` reliably.
 */
export function CreateDraftForm() {
  const t = useTranslations('Create');
  const [state, action, isPending] = useActionState<CreateDraftGiftResult | null, FormData>(
    async (_prev, formData) => createDraftGiftAction(formData),
    null,
  );

  return (
    <form action={action} className="lb-form" noValidate>
      <div className="lb-field">
        <label htmlFor="create-title">{t('titleLabel')}</label>
        <input
          id="create-title"
          name="title"
          type="text"
          maxLength={100}
          required
          autoFocus
          placeholder={t('titlePlaceholder')}
        />
      </div>

      <div className="lb-field">
        <label htmlFor="create-type">{t('typeLabel')}</label>
        <select id="create-type" name="type" defaultValue="animated_letter">
          {GIFT_TYPES.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
        <small className="lb-field__hint">{t('typeHint')}</small>
      </div>

      {state?.ok === false && (
        <p role="alert" className="lb-form__error">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        className="lb-btn lb-btn--primary"
        disabled={isPending}
      >
        {isPending ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}