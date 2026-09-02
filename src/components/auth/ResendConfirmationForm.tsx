'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import {
  resendConfirmationAction,
  type ResendConfirmationResult,
} from '@/lib/actions/auth';

/**
 * Explicit "send another confirmation email" control for the
 * /signup/check-email page (OOP-4274, comment 9fc72202).
 *
 * Replaces the silent resend that used to fire on every email-field
 * probe in `checkEmailAction` — that was a hidden side effect of typing
 * into the field, and when the underlying call failed (rate limit,
 * network) the copy still claimed "we just sent", which the user
 * spotted and called out.
 *
 * The button is the only forward path: the user clicks it, we call
 * `supabase.auth.resend`, and we report back honestly. Rate-limit
 * errors are surfaced as their own message so the user knows to wait
 * rather than wondering why nothing arrived.
 */
export function ResendConfirmationForm({ email }: { email: string }) {
  const t = useTranslations('Auth.checkEmail');
  const [state, action, isPending] = useActionState<ResendConfirmationResult | null, FormData>(
    async (_prev, formData) => resendConfirmationAction(formData),
    null,
  );

  return (
    <form className="lb-form" action={action} noValidate>
      <input type="hidden" name="email" value={email} />

      <p className="lb-form__error-hint">{t('missingHint')}</p>

      <button
        type="submit"
        className="lb-btn lb-btn--ghost lb-btn--block"
        disabled={isPending}
      >
        {isPending ? t('resendSending') : t('resendButton')}
      </button>

      {state?.ok === true && (
        <p role="status" className="lb-form__error-hint">
          {t('resendSent')}
        </p>
      )}

      {state?.ok === false && state.error === 'rate_limited' && (
        <p role="alert" className="lb-form__error">
          {t('resendRateLimited')}
        </p>
      )}

      {state?.ok === false && state.error !== 'rate_limited' && (
        <p role="alert" className="lb-form__error">
          {t('resendError')}
        </p>
      )}
    </form>
  );
}
