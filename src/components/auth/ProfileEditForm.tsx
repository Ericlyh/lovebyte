'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  upsertProfileAction,
  changeHandleAction,
  signOutAction,
  type UpsertProfileResult,
  type ChangeHandleResult,
} from '@/lib/actions/auth';
import {
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
} from '@/lib/profiles/handle';
import {
  useHandleAvailability,
  type HandleState,
} from '@/lib/hooks/useHandleAvailability';

const BIO_MAX = 600;

/**
 * /u/[handle]/edit — profile edit form (OOP-4340, M-B step 3c).
 *
 * Two distinct actions on one page so each can have its own button state
 * + error surface:
 *   1. `upsertProfileAction(formData)` — bio, links, display name. Saves
 *      in place, no redirect. The handle in the form is informational
 *      only; this action does NOT rename.
 *   2. `changeHandleAction(formData)` — handle rename. 30-day cooldown
 *      enforced by `public.change_handle` RPC. On success the user is
 *      bounced to /u/<new>.
 *
 * Avatar upload is intentionally disabled until the Storage bucket ships
 * (mirrors /onboarding).
 *
 * Sign out lives in the nav — `signOutAction` clears cookies and
 * `redirect('/')`.
 */
export function ProfileEditForm({
  currentHandle,
  currentDisplayName,
  currentBio,
  currentLinks,
  cooldownEndsAt,
}: {
  currentHandle: string;
  currentDisplayName: string;
  currentBio: string;
  currentLinks: string[];
  cooldownEndsAt: string | null;
}) {
  const t = useTranslations('Profile.edit');
  const tHandle = useTranslations('Profile.edit.handle');
  const router = useRouter();
  const [profilePending, startProfileTransition] = useTransition();
  const [handlePending, startHandleTransition] = useTransition();

  // Profile fields (bio + display_name + links) — uncontrolled except
  // for the live bio countdown, which we lift to state.
  const [bio, setBio] = useState(currentBio);
  const [profileResult, setProfileResult] = useState<UpsertProfileResult | null>(null);
  const bioRemaining = BIO_MAX - bio.length;

  // Handle field — controlled so the shared availability probe + the
  // cooldown banner share the same value.
  const [handle, setHandle] = useState(currentHandle);
  const handleState = useHandleAvailability(handle, { initialHandle: currentHandle });
  const [handleResult, setHandleResult] = useState<ChangeHandleResult | null>(null);

  const cooldownActive =
    cooldownEndsAt !== null && new Date(cooldownEndsAt) > new Date();
  const handleUnchanged = handle.trim().toLowerCase() === currentHandle;

  function handleProfileSubmit(formData: FormData) {
    startProfileTransition(async () => {
      const r = await upsertProfileAction(formData);
      setProfileResult(r);
    });
  }

  function handleHandleSubmit(formData: FormData) {
    startHandleTransition(async () => {
      const r = await changeHandleAction(formData);
      setHandleResult(r);
      if (r.ok) {
        setTimeout(() => router.push(`/u/${r.handle}`), 400);
      }
    });
  }

  return (
    <>
      {/* ---- Profile (bio / display name / links) -------------------- */}
      <form className="lb-form" action={handleProfileSubmit} noValidate>
        <h2 className="lb-form__section-heading">{t('displayName')}</h2>
        <label className="lb-field">
          <span>{t('displayName')}</span>
          <input
            type="text"
            name="display_name"
            defaultValue={currentDisplayName}
            maxLength={60}
            autoComplete="name"
            required
            aria-invalid={
              profileResult?.ok === false && profileResult.field === 'display_name'
                ? true
                : undefined
            }
          />
        </label>

        <label className="lb-field">
          <span>{t('bio.label')}</span>
          <textarea
            name="bio"
            maxLength={BIO_MAX}
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            aria-invalid={
              profileResult?.ok === false && profileResult.field === 'bio'
                ? true
                : undefined
            }
          />
          <small className="lb-field__hint">
            {t('bio.hint')}{' '}
            <span
              className={
                bioRemaining < 30
                  ? 'lb-field__countdown lb-field__countdown--warn'
                  : 'lb-field__countdown'
              }
            >
              {bioRemaining}
            </span>
          </small>
        </label>

        <label className="lb-field">
          <span>{t('links.label')}</span>
          <textarea
            name="links"
            rows={3}
            placeholder={t('links.placeholder')}
            defaultValue={currentLinks.join('\n')}
            aria-invalid={
              profileResult?.ok === false && profileResult.field === 'links'
                ? true
                : undefined
            }
          />
        </label>

        {/* Disabled avatar placeholder. Renders inside the same form
            so the layout lines up with /onboarding (M-B step 3). The
            input is `disabled` — submission doesn't carry it. */}
        <label className="lb-field">
          <span>{t('avatar.label')}</span>
          <input type="file" name="avatar" accept="image/*" disabled />
          <small className="lb-field__hint">{t('avatar.hint')}</small>
        </label>

        <button
          type="submit"
          className="lb-btn lb-btn--primary lb-btn--block"
          disabled={profilePending}
        >
          {profilePending ? t('savingProfile') : t('saveProfile')}
        </button>

        {profileResult?.ok === true && (
          <p role="status" className="lb-form__success">
            {t('profileSaved')}
          </p>
        )}
        {profileResult?.ok === false && (
          <p role="alert" className="lb-form__error">
            {profileResult.error}
          </p>
        )}
      </form>

      {/* ---- Handle rename (separate form, separate action) ---------- */}
      <form
        className="lb-form"
        action={handleHandleSubmit}
        noValidate
        aria-labelledby="lb-edit-handle-heading"
      >
        <h2 id="lb-edit-handle-heading" className="lb-form__section-heading">
          {t('handle.label')}
        </h2>
        <small className="lb-field__hint">
          {tHandle('currentLabel', { handle: currentHandle })}
        </small>

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
            disabled={cooldownActive}
            aria-invalid={
              handleState.kind === 'taken' || handleState.kind === 'invalid'
                ? true
                : undefined
            }
          />
          <small className="lb-field__hint">{tHandle('hint')}</small>
          <HandleStatus state={handleState} t={tHandle} />
          {cooldownActive && cooldownEndsAt && (
            <small className="lb-field__status lb-field__status--warn">
              {renderCooldown(cooldownEndsAt, tHandle)}
              {' · '}
              <time dateTime={cooldownEndsAt}>{cooldownEndsAt.slice(0, 10)}</time>
            </small>
          )}
        </label>

        <button
          type="submit"
          className="lb-btn lb-btn--primary lb-btn--block"
          disabled={
            handlePending ||
            cooldownActive ||
            handleUnchanged ||
            handleState.kind === 'taken' ||
            handleState.kind === 'invalid' ||
            handleState.kind === 'checking'
          }
        >
          {handlePending ? t('changingHandle') : t('changeHandle')}
        </button>

        {handleResult?.ok === true && (
          <p role="status" className="lb-form__success">
            {t('handleChanged')}
          </p>
        )}
        {handleResult?.ok === false && (
          <p role="alert" className="lb-form__error">
            {handleResult.error}
          </p>
        )}
      </form>
    </>
  );
}

/**
 * Render the "you can change your handle again in N days" countdown.
 * Pulled out so the JSX above stays readable; uses the
 * `Profile.edit.handle.cooldown*` keys.
 */
function renderCooldown(
  isoRetryAt: string,
  t: ReturnType<typeof useTranslations<'Profile.edit.handle'>>,
): string {
  const retry = new Date(isoRetryAt);
  const now = new Date();
  const diffMs = retry.getTime() - now.getTime();
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 1) return t('cooldownToday');
  return t('cooldown', { days });
}

function HandleStatus({
  state,
  t,
}: {
  state: HandleState;
  t: ReturnType<typeof useTranslations<'Profile.edit.handle'>>;
}) {
  switch (state.kind) {
    case 'empty':
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
      // OOP-4274 follow-up (comment 8c67ba51): show, don't hide. The
      // server probe failed (HTTP 500 on the deployed edge if env vars
      // went missing, network blip). Submit still re-runs the check.
      return <small className="lb-field__status lb-field__status--warn">{t('error')}</small>;
  }
}

export function ProfileEditSignOut() {
  const t = useTranslations('Profile.edit');
  return (
    <form action={signOutAction}>
      <button type="submit" className="lb-btn lb-btn--ghost lb-btn--sm">
        {t('signOut')}
      </button>
    </form>
  );
}
