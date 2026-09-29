'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  signUpAction,
  type AuthActionResult,
} from '@/lib/actions/auth';
import {
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
} from '@/lib/profiles/handle';
import {
  checkPasswordRules,
  isPasswordOk,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@/lib/forms/password';
import {
  useHandleAvailability,
  type HandleState,
} from '@/lib/hooks/useHandleAvailability';
import {
  useEmailAvailability,
  type EmailState,
} from '@/lib/hooks/useEmailAvailability';

/**
 * /signup form (M-B step 3, OOP-4284; OOP-4284 follow-up: live validation;
 * OOP-4274 follow-up: pre-submit email state).
 *
 * Live validation runs in the browser so the user sees handle availability,
 * email-state, and password rule progress before the form is submitted.
 * The server action still owns the *real* check (it can't be bypassed),
 * but on the happy path the form never round-trips with bad input —
 * meaning the existing input values stay in the DOM (no wipe) and the
 * user gets immediate feedback.
 *
 *   - `handle` → debounced 250 ms probe via `checkHandleAvailableAction`.
 *     Only the format/availability states disable submit.
 *   - `email`  → debounced 300 ms probe via `checkEmailAction`
 *     (OOP-4274 follow-up to comment 5291bacf). `verified` and `pending`
 *     render an inline card with a primary CTA and disable submit, so
 *     the user doesn't fill the rest of the form only to learn at
 *     submit time that their email is already registered.
 *   - `password` → local rule checklist (8+ chars, ≤72 chars).
 *   - `display_name` → uncontrolled; HTML5 + server enforce.
 *
 * Submission stays disabled while the local rules fail, so the action is
 * only invoked with values that already pass the live checks.
 */
export function SignupForm() {
  const t = useTranslations('Auth.signup');
  const tErr = useTranslations('Auth.errors');
  const tPw = useTranslations('Auth.signup.passwordRules');
  const tHandle = useTranslations('Auth.signup.handleStates');
  const tEmail = useTranslations('Auth.signup.emailStates');
  const [state, action, isPending] = useActionState<AuthActionResult | null, FormData>(
    async (_prev, formData) => signUpAction(formData),
    null,
  );

  const [handle, setHandle] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const handleState = useHandleAvailability(handle);
  const emailState = useEmailAvailability(email);
  const passwordRules = checkPasswordRules(password);
  const passwordOk = isPasswordOk(password);

  // The server's "field" hint (when its zod parse fails) only applies to
  // fields the user can fix without leaving the page — password, handle.
  const serverField = state?.ok === false ? state.field : undefined;

  // Submit is blocked when the live checks fail. We don't block on the
  // still-pending debounced probe (the user gets feedback in the hint);
  // server is the final arbiter of handle uniqueness anyway. `empty`
  // gates the required-handle-at-signup decision from the plan
  // (OOP-4284 follow-up).
  //
  // Email pre-check (OOP-4274 follow-up to comment 5291bacf): if the
  // email is already verified, resubmitting the form is pointless — the
  // user has to sign in. If it's pending, the confirmation link is in
  // their inbox, not something a new submit will produce. Block in both
  // cases so the inline CTA card is the only forward path.
  const submitBlocked =
    !passwordOk ||
    handleState.kind === 'invalid' ||
    handleState.kind === 'taken' ||
    handleState.kind === 'empty' ||
    emailState.kind === 'verified' ||
    emailState.kind === 'pending';

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
          aria-invalid={serverField === 'display_name' ? true : undefined}
        />
      </label>

      <label className="lb-field">
        <span>{t('handle')}</span>
        <input
          type="text"
          name="handle"
          autoComplete="username"
          minLength={HANDLE_MIN_LENGTH}
          maxLength={HANDLE_MAX_LENGTH}
          pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
          required
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          aria-invalid={
            serverField === 'handle' ||
            handleState.kind === 'taken' ||
            handleState.kind === 'invalid'
              ? true
              : undefined
          }
        />
        <HandleStatus state={handleState} emptyHint={t('handleHint')} t={tHandle} />
      </label>

      <label className="lb-field">
        <span>{t('email')}</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={
            serverField === 'email' ||
            emailState.kind === 'verified' ||
            emailState.kind === 'pending' ||
            emailState.kind === 'invalid'
              ? true
              : undefined
          }
        />
        <EmailStatus state={emailState} email={email} t={tEmail} />
      </label>

      <label className="lb-field">
        <span>{t('password')}</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={serverField === 'password' ? true : undefined}
        />
        <ul className="lb-field__rules" aria-label={t('password')}>
          <PasswordRuleRow
            ok={passwordRules[0].ok}
            label={tPw('minLength', { count: PASSWORD_MIN_LENGTH })}
          />
          <PasswordRuleRow
            ok={passwordRules[1].ok}
            label={tPw('maxLength', { count: PASSWORD_MAX_LENGTH })}
          />
        </ul>
      </label>

      <button
        type="submit"
        className="lb-btn lb-btn--primary lb-btn--block"
        disabled={isPending || submitBlocked}
      >
        {isPending ? t('submitting') : t('submit')}
      </button>

      {state?.ok === false && state.error === 'EMAIL_VERIFIED' && (
        // CTA card (OOP-4284 follow-up, comment 339c9a62): the previous
        // inline text + link was too understated and the user read it as
        // "the form is broken". A primary-styled link is harder to miss.
        <div role="alert" className="lb-form__error lb-form__error--card">
          <p className="lb-form__error-title">{tErr('emailVerified')}</p>
          <p className="lb-form__error-hint">{tErr('emailVerifiedHint')}</p>
          <Link className="lb-btn lb-btn--primary lb-btn--block" href="/login">
            {t('signinLink')}
          </Link>
        </div>
      )}

      {state?.ok === false && state.error !== 'EMAIL_VERIFIED' && (
        <p role="alert" className="lb-form__error">
          {state.error === 'EMAIL_EXISTS'
            ? tErr('emailExists')
            : state.error || tErr('generic')}
        </p>
      )}
    </form>
  );
}

function PasswordRuleRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? 'lb-field__rule lb-field__rule--ok' : 'lb-field__rule'}>
      {label}
    </li>
  );
}

function HandleStatus({
  state,
  emptyHint,
  t,
}: {
  state: HandleState;
  emptyHint: string;
  t: (key: 'checking' | 'available' | 'taken' | 'invalid' | 'error') => string;
}) {
  switch (state.kind) {
    case 'empty':
      return <small className="lb-field__hint">{emptyHint}</small>;
    case 'checking':
      return <small className="lb-field__status lb-field__status--checking">{t('checking')}</small>;
    case 'available':
      return <small className="lb-field__status lb-field__status--ok">{t('available')}</small>;
    case 'taken':
      return <small className="lb-field__status lb-field__status--bad">{t('taken')}</small>;
    case 'invalid':
      return <small className="lb-field__status lb-field__status--bad">{t('invalid')}</small>;
    case 'error':
      // Visible — the server probe failed (HTTP 500 on the deployed edge
      // if env vars went missing, network blip, etc.). Don't hide it: the
      // user needs to know the live check is down so they don't think the
      // page is broken. The form action still re-runs the check on submit.
      return <small className="lb-field__status lb-field__status--warn">{t('error')}</small>;
  }
}

/**
 * Inline status under the email field (OOP-4274 follow-up to comment
 * 5291bacf). Verified and pending render an alert card with a primary
 * CTA so the user can act without filling out the rest of the form.
 * Other states render a small status line mirroring `HandleStatus`.
 */
function EmailStatus({
  state,
  email,
  t,
}: {
  state: EmailState;
  email: string;
  t: ReturnType<typeof useTranslations<'Auth.signup.emailStates'>>;
}) {
  if (state.kind === 'verified') {
    return (
      <div role="alert" className="lb-form__error lb-form__error--card">
        <p className="lb-form__error-title">{t('verified.title')}</p>
        <p className="lb-form__error-hint">{t('verified.body')}</p>
        <Link className="lb-btn lb-btn--primary lb-btn--block" href="/login">
          {t('verified.cta')}
        </Link>
      </div>
    );
  }
  if (state.kind === 'pending') {
    const checkEmailHref = email
      ? `/signup/check-email?email=${encodeURIComponent(email.trim())}`
      : '/signup/check-email';
    return (
      <div role="alert" className="lb-form__error lb-form__error--card">
        <p className="lb-form__error-title">{t('pending.title')}</p>
        <p className="lb-form__error-hint">{t('pending.body')}</p>
        <Link className="lb-btn lb-btn--primary lb-btn--block" href={checkEmailHref}>
          {t('pending.cta')}
        </Link>
      </div>
    );
  }
  switch (state.kind) {
    case 'empty':
      return null;
    case 'invalid':
      return null; // email field's own `required` + browser hint is enough
    case 'checking':
      return <small className="lb-field__status lb-field__status--checking">{t('checking')}</small>;
    case 'not_found':
      return null;
    case 'error':
      return <small className="lb-field__status lb-field__status--warn">{t('error')}</small>;
  }
}
