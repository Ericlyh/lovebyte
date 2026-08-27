'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { signUpAction, type AuthActionResult } from '@/lib/actions/auth';

/**
 * /signup form (M-B step 3, OOP-4284).
 *
 * Calls `signUpAction` via `useActionState`. On success the server
 * action redirects to `/onboarding` (new account) or `/signup/check-email`
 * (email confirmation flow). On failure it returns `{ ok: false, error }`
 * which we render below the submit button.
 *
 * Why a separate client component: `useActionState` is a client hook.
 * The surrounding page stays a Server Component for i18n + metadata.
 */
export function SignupForm() {
  const t = useTranslations('Auth.signup');
  const tErr = useTranslations('Auth.errors');
  const [state, action, isPending] = useActionState<AuthActionResult | null, FormData>(
    async (_prev, formData) => signUpAction(formData),
    null,
  );

  return (
    <form className="lb-form" action={action} noValidate>
      <label className="lb-field">
        <span>{t('displayName')}</span>
        <input
          type="text"
          name="display_name"
          autoComplete="name"
          maxLength={60}
          required
          aria-invalid={state?.ok === false && state.field === 'display_name' ? true : undefined}
        />
      </label>

      <label className="lb-field">
        <span>{t('handle')}</span>
        <input
          type="text"
          name="handle"
          autoComplete="username"
          minLength={3}
          maxLength={20}
          pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
          aria-invalid={state?.ok === false && state.field === 'handle' ? true : undefined}
        />
      </label>

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
          autoComplete="new-password"
          minLength={8}
          maxLength={72}
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