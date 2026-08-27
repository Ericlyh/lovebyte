'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  checkHandleAvailableAction,
  upsertProfileAction,
  type UpsertProfileResult,
} from '@/lib/actions/auth';
import {
  isValidHandle,
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
} from '@/lib/profiles/handle';

type HandleState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'taken' }
  | { kind: 'invalid' }
  | { kind: 'error' };

/**
 * /onboarding form (M-B step 3, OOP-4284).
 *
 * Two server actions wired:
 *   - `checkHandleAvailableAction(handle)` — debounced 250ms; updates
 *     the "available / taken / invalid" hint under the handle input.
 *   - `upsertProfileAction(formData)` — submits the whole profile.
 *     On success we `router.push('/u/<handle>')` for the preview.
 *
 * Avatar upload is intentionally a TODO — the `avatars` Storage bucket
 * isn't created yet (the existing convention is `lovebyte-media`). See
 * the OOP-4284 follow-ups; for now we render a disabled file input so
 * the form structure stays locked.
 */
export function OnboardingForm({
  initialHandle,
  initialDisplayName,
  initialBio,
  initialLinks,
}: {
  initialHandle: string;
  initialDisplayName: string;
  initialBio: string;
  initialLinks: string[];
}) {
  const t = useTranslations('Onboarding');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [handle, setHandle] = useState(initialHandle);
  const [handleState, setHandleState] = useState<HandleState>(
    isValidHandle(initialHandle) ? { kind: 'available' } : { kind: 'idle' },
  );
  const [result, setResult] = useState<UpsertProfileResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCheckedRef = useRef<string>(initialHandle);

  // Debounced handle availability probe. 250ms per OOP-4284.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = handle.trim().toLowerCase();
    if (trimmed === lastCheckedRef.current) return;

    if (trimmed.length === 0) {
      setHandleState({ kind: 'idle' });
      return;
    }
    if (!isValidHandle(trimmed)) {
      setHandleState({ kind: 'invalid' });
      return;
    }
    setHandleState({ kind: 'checking' });

    debounceRef.current = setTimeout(async () => {
      const res = await checkHandleAvailableAction(trimmed);
      lastCheckedRef.current = trimmed;
      if (res.ok) {
        setHandleState(res.available ? { kind: 'available' } : { kind: 'taken' });
      } else {
        setHandleState({ kind: 'error' });
      }
    }, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [handle]);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const r = await upsertProfileAction(formData);
      setResult(r);
      if (r.ok) {
        // Brief "saved" banner, then navigate to the public profile.
        setTimeout(() => router.push(`/u/${r.handle}`), 400);
      }
    });
  }

  const linksInitial = initialLinks.join('\n');

  return (
    <form
      className="lb-form"
      action={handleSubmit}
      noValidate
    >
      <label className="lb-field">
        <span>{t('handle.label')}</span>
        <input
          type="text"
          name="handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          minLength={HANDLE_MIN_LENGTH}
          maxLength={HANDLE_MAX_LENGTH}
          pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
          autoComplete="username"
          required
          aria-invalid={
            handleState.kind === 'taken' || handleState.kind === 'invalid'
              ? true
              : undefined
          }
        />
        <small className="lb-field__hint">{t('handle.hint')}</small>
        <HandleStatus state={handleState} />
      </label>

      <label className="lb-field">
        <span>{t('displayName.label')}</span>
        <input
          type="text"
          name="display_name"
          defaultValue={initialDisplayName}
          maxLength={60}
          autoComplete="name"
          required
        />
      </label>

      <label className="lb-field">
        <span>{t('avatar.label')}</span>
        <input type="file" name="avatar" accept="image/*" disabled />
        <small className="lb-field__hint">{t('avatar.hint')}</small>
      </label>

      <label className="lb-field">
        <span>{t('bio.label')}</span>
        <textarea
          name="bio"
          maxLength={600}
          rows={4}
          defaultValue={initialBio}
        />
        <small className="lb-field__hint">{t('bio.hint')}</small>
      </label>

      <label className="lb-field">
        <span>{t('links.label')}</span>
        <textarea
          name="links"
          rows={3}
          placeholder={t('links.placeholder')}
          defaultValue={linksInitial}
        />
      </label>

      <button
        type="submit"
        className="lb-btn lb-btn--primary lb-btn--block"
        disabled={isPending || handleState.kind === 'taken' || handleState.kind === 'invalid'}
      >
        {isPending ? t('submitting') : t('submit')}
      </button>

      {result?.ok === true && (
        <p role="status" className="lb-form__success">
          {t('saved')}
        </p>
      )}
      {result?.ok === false && (
        <p role="alert" className="lb-form__error">
          {result.error}
        </p>
      )}
    </form>
  );
}

function HandleStatus({ state }: { state: HandleState }) {
  const t = useTranslations('Onboarding.handle');
  switch (state.kind) {
    case 'idle':
      return null;
    case 'checking':
      return <small className="lb-field__status lb-field__status--checking">{t('checking')}</small>;
    case 'available':
      return <small className="lb-field__status lb-field__status--ok">{t('available')}</small>;
    case 'taken':
      return <small className="lb-field__status lb-field__status--bad">{t('taken')}</small>;
    case 'invalid':
      return <small className="lb-field__status lb-field__status--bad">{t('invalid')}</small>;
    case 'error':
      return null;
  }
}