'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  createGiftReplyAction,
  type CreatedGiftReply,
} from '@/lib/actions/giftReplies';

/**
 * Reply composer for /l/[giftId] (M-G, OOP-4890).
 *
 * Two flavours:
 *   - Top-level composer (default, no `parentReplyId`) — asks the
 *     creator a question on the listing.
 *   - Sub-reply composer (with `parentReplyId`) — replies to an
 *     existing question in the thread.
 *
 * Three render modes, mirrors CommentForm / LikeButton / FollowButton:
 *   - `loading` : SSR-safe placeholder.
 *   - `anon`    : link to /login?next=<listing-url>.
 *   - `authed`  : textarea + char counter + submit button.
 *
 * Auth comes from the same `/api/me` probe the like/follow buttons
 * use, so the three widgets stay consistent. On a successful create
 * we surface the new reply back to the parent via `onCreated` (the
 * parent appends it to its tree), then clear the textarea. Server-side
 * `revalidatePath` ensures the next SSR pass shows the row in the
 * canonical thread.
 */

type Mode = 'loading' | 'anon' | 'authed';
type MeResponse = { authed: boolean; userId: string | null };

const MAX_LENGTH = 1000;

type Props = {
  giftId: string;
  parentReplyId?: string;
  composerLabel?: string;
  placeholder?: string;
  submitLabel?: string;
  submittingLabel?: string;
  onCreated?: (reply: CreatedGiftReply) => void;
  onCancel?: () => void;
};

export function ReplyForm({
  giftId,
  parentReplyId,
  composerLabel,
  placeholder,
  submitLabel,
  submittingLabel,
  onCreated,
  onCancel,
}: Props) {
  const t = useTranslations('Catalog.replies');
  const formId = useId();
  const [mode, setMode] = useState<Mode>('loading');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
      .then((data) => {
        if (cancelled) return;
        setMode(data?.authed ? 'authed' : 'anon');
      })
      .catch(() => {
        if (!cancelled) setMode('anon');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = body.trim();
  const remaining = MAX_LENGTH - trimmed.length;
  const tooLong = remaining < 0;
  const tooShort = trimmed.length === 0;
  const canSubmit = !tooLong && !tooShort && !isPending;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode !== 'authed' || !canSubmit) return;
    setError(null);
    startTransition(async () => {
      const result = await createGiftReplyAction({
        giftId,
        body: trimmed,
        parentReplyId,
      });
      if (!result.ok) {
        if (result.error === 'unauthenticated') {
          setMode('anon');
          setError(parentReplyId ? t('signInToReply') : t('signInToReply'));
        } else {
          setError(result.error);
        }
        return;
      }
      // Hand the row back to the parent so the optimistic tree shows
      // it immediately. The server also revalidates `/l/<giftId>` so
      // a hard reload picks it up canonically.
      onCreated?.(result.reply);
      setBody('');
      textareaRef.current?.focus();
      onCancel?.();
    });
  }

  if (mode === 'loading') {
    return (
      <div className="lb-reply-form" aria-hidden="true" data-loading="true">
        <span className="lb-reply-form__placeholder" />
      </div>
    );
  }

  if (mode === 'anon') {
    return (
      <div className="lb-reply-form lb-reply-form--anon">
        <p className="lb-reply-form__hint">{t('signInPrompt')}</p>
        <Link
          className="lb-btn lb-btn--sm lb-btn--primary"
          href={`/login?next=${encodeURIComponent(`/l/${giftId}`)}`}
        >
          {t('signInCta')}
        </Link>
      </div>
    );
  }

  return (
    <form
      id={formId}
      className="lb-reply-form"
      onSubmit={onSubmit}
      aria-describedby={error ? `${formId}-error` : undefined}
    >
      <label htmlFor={`${formId}-body`} className="lb-reply-form__label">
        {composerLabel ?? (parentReplyId ? t('replyComposerLabel') : t('composerLabel'))}
      </label>
      <textarea
        ref={textareaRef}
        className="lb-reply-form__textarea"
        rows={3}
        maxLength={MAX_LENGTH + 50 /* allow visual over so the counter can show */}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder ?? (parentReplyId ? t('replyPlaceholder') : t('placeholder'))}
        disabled={isPending}
      />
      <div className="lb-reply-form__bar">
        <span
          className={`lb-reply-form__count${tooLong ? ' lb-reply-form__count--over' : ''}`}
        >
          {t('charCount', { count: trimmed.length, max: MAX_LENGTH })}
        </span>
        {error ? (
          <span id={`${formId}-error`} className="lb-reply-form__error" role="alert">
            {error}
          </span>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            className="lb-btn lb-btn--sm lb-btn--ghost"
            onClick={onCancel}
            disabled={isPending}
          >
            {t('cancel')}
          </button>
        ) : null}
        <button
          type="submit"
          className="lb-btn lb-btn--sm lb-btn--primary"
          disabled={!canSubmit}
        >
          {isPending
            ? (submittingLabel ?? (parentReplyId ? t('replySubmitting') : t('submitting')))
            : (submitLabel ?? (parentReplyId ? t('replySubmit') : t('submit')))}
        </button>
      </div>
    </form>
  );
}