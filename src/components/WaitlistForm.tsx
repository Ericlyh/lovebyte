'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  joinWaitlistAction,
  type JoinWaitlistResult,
} from '@/lib/actions/waitlist';

/**
 * Landing-page waitlist form (Phase 10, OOP-4226).
 *
 * Wired to `joinWaitlistAction` via `useActionState`. The server action
 * is the only insert path for `public.waitlist` (no anon INSERT policy)
 * and applies its own rate-limit + Zod validation, so this form is
 * intentionally minimal — no client-side regex, no live email probe.
 * That's the same pattern the rest of the marketplace uses (signup
 * pre-checks the handle / email live; the waitlist has no such
 * uniqueness concern because the server action rejects duplicates
 * with a friendly "already on the list" status).
 *
 * Why no Turnstile/hCaptcha widget here yet? The action's IP+UA
 * rate-limit is the placeholder (see src/lib/actions/waitlist.ts
 * "Out of scope" comment). Once TURNSTILE_SECRET_KEY is wired, the
 * verify call goes inside the action and the widget is added to this
 * component — that's a single-file change. Shipping without the
 * CAPTCHA is acceptable for the closed beta because the landing
 * traffic is low; the rate-limit + service-role-only path keeps the
 * table from filling with bot rows.
 */
export function WaitlistForm() {
  const t = useTranslations('Landing.waitlist');
  const locale = useLocale();

  const [state, action, isPending] = useActionState<JoinWaitlistResult | null, FormData>(
    async (_prev, formData) => {
      const intent = (formData.get('intent') as string | null)?.trim() || undefined;
      return joinWaitlistAction({
        email: String(formData.get('email') ?? ''),
        intent,
        locale: locale === 'zh-Hant' ? 'zh-Hant' : 'en',
      });
    },
    null,
  );

  const formRef = useRef<HTMLFormElement>(null);

  // On success, reset the email field so a re-submit doesn't
  // accidentally double-fire. The status message stays visible so the
  // user sees the "you're on the list" confirmation.
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
    }
  }, [state]);

  if (state?.ok) {
    return (
      <div className="lb-waitlist-success" role="status" aria-live="polite">
        <p className="lb-waitlist-success__title">{t('successTitle')}</p>
        <p className="lb-waitlist-success__body">
          {state.status === 'already_on_list'
            ? t('successAlready')
            : t('successInserted')}
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} className="lb-form lb-waitlist" action={action} noValidate>
      <label className="lb-field">
        <span>{t('emailLabel')}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder={t('emailPlaceholder')}
          disabled={isPending}
        />
      </label>
      <label className="lb-field">
        <span>{t('intentLabel')}</span>
        <select name="intent" defaultValue="" disabled={isPending}>
          <option value="">{t('intentPlaceholder')}</option>
          <option value="personal">{t('intentPersonal')}</option>
          <option value="hk-sme">{t('intentHkSme')}</option>
          <option value="creator">{t('intentCreator')}</option>
        </select>
      </label>
      <button type="submit" className="lb-btn lb-btn--primary" disabled={isPending}>
        {isPending ? t('submitting') : t('submit')}
      </button>
      {state?.ok === false ? (
        <p className="lb-form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <p className="lb-waitlist-foot">{t('fineprint')}</p>
    </form>
  );
}
