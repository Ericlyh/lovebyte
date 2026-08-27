'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { signInAction, type AuthActionResult } from '@/lib/actions/auth';

/**
 * /login form (M-B step 3, OOP-4284).
 *
 * Calls `signInAction` via `useActionState`. Success redirects to `/`
 * (per OOP-4284 spec). Failure returns `{ ok: false, error }`.
 */
export function LoginForm() {
  const t = useTranslations('Auth.login');
  const tErr = useTranslations('Auth.errors');
  const [state, action, isPending] = useActionState<AuthActionResult | null, FormData>(
    async (_prev, formData) => signInAction(formData),
    null,
  );

  return (
    <form className="lb-form" action={action} noValidate>
      <label className="lb-field">
        <span>{t('email')}</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          aria-invalid={state?.ok === false && state.field === 'email' ? true : undefined}
        />
      </label>

      <label className="lb-field">
        <span>{t('password')}</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={state?.ok === false && state.field === 'password' ? true : undefined}
        />
      </label>

      <button
        type="submit"
        className="lb-btn lb-btn--primary lb-btn--block"
        disabled={isPending}
      >
        {isPending ? t('submitting') : t('submit')}
      </button>

      {state?.ok === false && (
        <p role="alert" className="lb-form__error">
          {state.error || tErr('generic')}
        </p>
      )}
    </form>
  );
}