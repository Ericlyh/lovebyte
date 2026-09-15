'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  createCommentAction,
  type CreatedComment,
} from '@/lib/actions/comments';

/**
 * Comment composer for /l/[giftId] (M-D, OOP-4276).
 *
 * Three render modes — mirrors LikeButton / FollowButton:
 *   - `loading` : SSR-safe placeholder.
 *   - `anon`    : link to /login?next=<listing-url>.
 *   - `authed`  : textarea + char counter + submit button.
 *
 * Auth comes from the same `/api/me` probe the like/follow buttons
 * use, so the three widgets stay consistent. On a successful create
 * we surface the new comment back to the parent via `onCreated`
 * (the parent appends it to its optimistic list), then clear the
 * textarea. Server-side `revalidatePath` ensures the next SSR pass
 * shows the row in the canonical thread.
 */

type Mode = 'loading' | 'anon' | 'authed';
type MeResponse = { authed: boolean; userId: string | null };

const MAX_LENGTH = 1000;

type Props = {
  giftId: string;
  onCreated?: (comment: CreatedComment) => void;
};

export function CommentForm({ giftId, onCreated }: Props) {
  const t = useTranslations('Catalog.comments');
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
      const result = await createCommentAction({ giftId, body: trimmed });
      if (!result.ok) {
        if (result.error === 'unauthenticated') {
          setMode('anon');
          setError(t('signInToComment'));
        } else {
          setError(result.error);
        }
        return;
      }
      // Hand the row back to the parent so the optimistic list shows
      // it immediately. The server also revalidates `/l/<giftId>` so
      // a hard reload picks it up canonically.
      onCreated?.(result.comment);
      setBody('');
      textareaRef.current?.focus();
    });
  }

  if (mode === 'loading') {
    return (
      <div className="lb-comment-form" aria-hidden="true" data-loading="true">
        <span className="lb-comment-form__placeholder" />
      </div>
    );
  }

  if (mode === 'anon') {
    return (
      <div className="lb-comment-form lb-comment-form--anon">
        <p className="lb-comment-form__hint">{t('signInPrompt')}</p>
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
      className="lb-comment-form"
      onSubmit={onSubmit}
      aria-describedby={error ? `${formId}-error` : undefined}
    >
      <label htmlFor={`${formId}-body`} className="lb-comment-form__label">
        {t('composerLabel')}
      </label>
      <textarea
        ref={textareaRef}
        id={`${formId}-body`}
        className="lb-comment-form__textarea"
        rows={3}
        maxLength={MAX_LENGTH + 50 /* allow visual over so the counter can show */}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('placeholder')}
        disabled={isPending}
      />
      <div className="lb-comment-form__bar">
        <span
          className={`lb-comment-form__count${tooLong ? ' lb-comment-form__count--over' : ''}`}
        >
          {t('charCount', { count: trimmed.length, max: MAX_LENGTH })}
        </span>
        {error ? (
          <span id={`${formId}-error`} className="lb-comment-form__error" role="alert">
            {error}
          </span>
        ) : null}
        <button
          type="submit"
          className="lb-btn lb-btn--sm lb-btn--primary"
          disabled={!canSubmit}
        >
          {isPending ? t('submitting') : t('submit')}
        </button>
      </div>
    </form>
  );
}