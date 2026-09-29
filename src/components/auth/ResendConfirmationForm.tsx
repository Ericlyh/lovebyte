'use client';

import Link from 'next/link';
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
 * `supabase.auth.resend`, and we report back honestly. The action now
 * (OOP-5379) pre-checks via `lookupEmail` and branches:
 *   - already_verified → CTA to /login (the user can already sign in;
 *     GoTrue's resend silently 200s without sending, and the old "Sent!"
 *     copy was a lie — that's the bug this card was filed against).
 *   - pending / ok:true → standard "Sent" copy.
 *   - not_found → CTA to /signup.
 *   - rate_limited / generic → existing error copy.
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

      {state?.ok === false && state.error === 'already_verified' && (
        <div role="status" className="lb-form__error lb-form__error--card">
          <p className="lb-form__error-title">{t('resendAlreadyVerifiedTitle')}</p>
          <p className="lb-form__error-hint">{t('resendAlreadyVerifiedBody')}</p>
          <Link className="lb-btn lb-btn--primary lb-btn--block" href="/login">
            {t('resendAlreadyVerifiedCta')}
          </Link>
        </div>
      )}

      {state?.ok === false && state.error === 'not_found' && (
        <div role="status" className="lb-form__error lb-form__error--card">
          <p className="lb-form__error-title">{t('resendNotFoundTitle')}</p>
          <p className="lb-form__error-hint">{t('resendNotFoundBody')}</p>
          <Link className="lb-btn lb-btn--primary lb-btn--block" href="/signup">
            {t('resendNotFoundCta')}
          </Link>
        </div>
      )}

      {state?.ok === false && state.error === 'rate_limited' && (
        <p role="alert" className="lb-form__error">
          {t('resendRateLimited')}
        </p>
      )}

      {state?.ok === false &&
        state.error !== 'rate_limited' &&
        state.error !== 'already_verified' &&
        state.error !== 'not_found' && (
          <p role="alert" className="lb-form__error">
            {t('resendError')}
          </p>
        )}
    </form>
  );
}