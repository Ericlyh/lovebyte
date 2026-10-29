'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { signInAction, type AuthActionResult } from '@/lib/actions/auth';

/**
 * /login form (M-B step 3, OOP-4284).
 *
 * Calls `signInAction` via `useActionState`. Success redirects to the
 * `next` return path when one was supplied, and to `/` otherwise
 * (per OOP-4284 spec). Failure returns `{ ok: false, error }`.
 *
 * `nextPath` (OOP-6718) is already sanitised by the page that renders
 * this form; the action validates it again before redirecting.
 */
export function LoginForm({ nextPath }: { nextPath?: string }) {
  const t = useTranslations('Auth.login');
  const tErr = useTranslations('Auth.errors');
  const [state, action, isPending] = useActionState<AuthActionResult | null, FormData>(
    async (_prev, formData) => signInAction(formData),
    null,
  );

  return (
    <form className="lb-form" action={action} noValidate>
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
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