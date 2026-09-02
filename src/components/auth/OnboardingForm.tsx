'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  upsertProfileAction,
  type UpsertProfileResult,
} from '@/lib/actions/auth';
import {
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
} from '@/lib/profiles/handle';
import {
  useHandleAvailability,
  type HandleState,
} from '@/lib/hooks/useHandleAvailability';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCEPTED_AVATAR = 'image/png,image/jpeg,image/webp,image/gif';

type AvatarUpload =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'uploaded'; mediaId: string; previewUrl: string }
  | { kind: 'failed'; error: string };

/**
 * /onboarding form (M-B step 3, OOP-4284 + OOP-4310).
 *
 * Two server actions wired:
 *   - `checkHandleAvailableAction(handle)` — debounced 250ms; updates
 *     the "available / taken / invalid" hint under the handle input.
 *   - `upsertProfileAction(formData)` — submits the whole profile.
 *     On success we `router.push('/u/<handle>')` for the preview.
 *
 * Avatar upload (OOP-4310 follow-up):
 *   The client picks a file, validates size + mime locally, then POSTs
 *   the bytes to `/api/upload/avatar`. That route writes the file to
 *   the `lovebyte-media` bucket under `avatars/<user-id>/…` and inserts
 *   a `gift_media` row. We stash the resulting `mediaId` in a hidden
 *   form input so `upsertProfileAction` can attach it to the profile.
 *   If the user re-submits without picking a new file, the existing
 *   `initialMediaId` is forwarded unchanged — saves don't drop the
 *   current avatar.
 */
export function OnboardingForm({
  initialHandle,
  initialDisplayName,
  initialBio,
  initialLinks,
  initialMediaId,
  initialAvatarUrl,
}: {
  initialHandle: string;
  initialDisplayName: string;
  initialBio: string;
  initialLinks: string[];
  initialMediaId: string | null;
  initialAvatarUrl: string | null;
}) {
  const t = useTranslations('Onboarding');
  const tAvatar = useTranslations('Onboarding.avatar');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [handle, setHandle] = useState(initialHandle);
  const handleState = useHandleAvailability(handle, { initialHandle });
  const [result, setResult] = useState<UpsertProfileResult | null>(null);

  // Avatar state — `previewUrl` is an object URL while a new file is
  // picked, falling back to the server-rendered `initialAvatarUrl` when
  // the user hasn't touched the input.
  const [avatar, setAvatar] = useState<AvatarUpload>(() =>
    initialMediaId
      ? { kind: 'uploaded', mediaId: initialMediaId, previewUrl: initialAvatarUrl ?? '' }
      : { kind: 'idle' },
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Free the object URL when we replace or unmount the preview.
  useEffect(() => {
    return () => {
      if (avatar.kind === 'uploaded' && avatar.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatar.previewUrl);
      }
    };
  }, [avatar]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatar({ kind: 'failed', error: tAvatar('tooLarge') });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (!ACCEPTED_AVATAR.split(',').includes(file.type)) {
      setAvatar({ kind: 'failed', error: tAvatar('badType') });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setAvatar({ kind: 'uploading' });
    const previewUrl = URL.createObjectURL(file);
    void uploadAvatar(file, previewUrl);
  }

  async function uploadAvatar(file: File, previewUrl: string) {
    const body = new FormData();
    body.append('file', file);
    let res: Response;
    try {
      res = await fetch('/api/upload/avatar', { method: 'POST', body });
    } catch (e) {
      setAvatar({ kind: 'failed', error: tAvatar('networkError') });
      URL.revokeObjectURL(previewUrl);
      return;
    }
    if (!res.ok) {
      let detail = '';
      try {
        const j = (await res.json()) as { error?: string };
        detail = j.error ?? '';
      } catch {
        // ignore — the generic status-based message will be shown
      }
      setAvatar({
        kind: 'failed',
        error: detail || tAvatar('uploadFailed'),
      });
      URL.revokeObjectURL(previewUrl);
      return;
    }
    const json = (await res.json()) as { ok: boolean; mediaId?: string; publicUrl?: string };
    if (!json.ok || !json.mediaId) {
      setAvatar({ kind: 'failed', error: tAvatar('uploadFailed') });
      URL.revokeObjectURL(previewUrl);
      return;
    }
    setAvatar({
      kind: 'uploaded',
      mediaId: json.mediaId,
      previewUrl: json.publicUrl ?? previewUrl,
    });
  }

  function handleSubmit(formData: FormData) {
    // If a new file is still uploading, block the submit and surface a
    // hint — once the upload resolves, the user can re-submit.
    if (avatar.kind === 'uploading') {
      setResult({ ok: false, error: tAvatar('stillUploading') });
      return;
    }
    if (avatar.kind === 'failed') {
      setResult({ ok: false, error: avatar.error });
      return;
    }
    // Forward the media id (either a fresh upload or the initial one).
    if (avatar.kind === 'uploaded') {
      formData.set('avatar_media_id', avatar.mediaId);
    }
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
  const previewSrc =
    avatar.kind === 'uploaded'
      ? avatar.previewUrl
      : avatar.kind === 'failed' && initialAvatarUrl
        ? initialAvatarUrl
        : '';
  const submitDisabled =
    isPending ||
    avatar.kind === 'uploading' ||
    handleState.kind === 'taken' ||
    handleState.kind === 'invalid';

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

      {/* Hidden input that carries the uploaded avatar's media id into
          upsertProfileAction. Stays in sync with `avatar.kind === 'uploaded'`. */}
      <input
        type="hidden"
        name="avatar_media_id"
        value={avatar.kind === 'uploaded' ? avatar.mediaId : ''}
      />

      <div className="lb-field lb-field--avatar">
        <span>{t('avatar.label')}</span>
        <div className="lb-avatar-row">
          {previewSrc ? (
            <img
              className="lb-avatar-preview"
              src={previewSrc}
              alt={tAvatar('previewAlt')}
            />
          ) : (
            <div className="lb-avatar-preview lb-avatar-preview--empty" aria-hidden="true">
              {tAvatar('placeholder')}
            </div>
          )}
          <div className="lb-avatar-controls">
            <input
              ref={fileInputRef}
              type="file"
              name="avatar"
              accept={ACCEPTED_AVATAR}
              onChange={handleFileChange}
              disabled={avatar.kind === 'uploading'}
              aria-describedby="lb-avatar-hint"
            />
            <small id="lb-avatar-hint" className="lb-field__hint">
              {t('avatar.hint')}
            </small>
            <AvatarStatus avatar={avatar} t={tAvatar} />
          </div>
        </div>
      </div>

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
        disabled={submitDisabled}
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
      // server probe failed — the user needs to know the live check is
      // down so they don't think the page is stuck. Submission still
      // re-runs the check via `upsertProfileAction`.
      return <small className="lb-field__status lb-field__status--warn">{t('error')}</small>;
  }
}

function AvatarStatus({
  avatar,
  t,
}: {
  avatar: AvatarUpload;
  t: ReturnType<typeof useTranslations<'Onboarding.avatar'>>;
}) {
  switch (avatar.kind) {
    case 'uploading':
      return <small className="lb-field__status lb-field__status--checking">{t('uploading')}</small>;
    case 'uploaded':
      return <small className="lb-field__status lb-field__status--ok">{t('uploaded')}</small>;
    case 'failed':
      return <small className="lb-field__status lb-field__status--bad">{avatar.error}</small>;
    case 'idle':
      return null;
  }
}
