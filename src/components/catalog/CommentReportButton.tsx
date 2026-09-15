'use client';

import { useId, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Report-comment affordance (M-D, OOP-4276).
 *
 * Renders a "Report" button that opens an inline textarea + submit
 * form. POSTs to /api/comment-reports with `{ comment_id, reason }`.
 *
 * Why not a modal?  A modal needs a portal, focus trap, and escape
 * handler — none of which earns its keep for a 1-field form that
 * already has a clear "Cancel" path. The inline form is also a11y-
 * friendlier: no focus shift, no scroll lock.
 *
 * RLS `comment_reports_insert_authenticated` requires an authed
 * session. We don't probe `/api/me` here — the parent thread already
 * knows whether the viewer is signed in, and hides this button
 * entirely when they aren't.
 */

const MAX_REASON = 500;

type Props = {
  commentId: string;
  /** Suppress rendering when the viewer isn't signed in. */
  authed: boolean;
};

export function CommentReportButton({ commentId, authed }: Props) {
  const t = useTranslations('Catalog.comments');
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!authed) return null;

  if (submitted) {
    return (
      <span className="lb-comment-report lb-comment-report--thanks">
        {t('reportThanks')}
      </span>
    );
  }

  const trimmed = reason.trim();
  const tooLong = trimmed.length > MAX_REASON;
  const tooShort = trimmed.length === 0;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (tooShort || tooLong || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/comment-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            comment_id: commentId,
            reason: trimmed,
          }),
        });
        const data: { ok: boolean; error?: string } = await res
          .json()
          .catch(() => ({ ok: false, error: 'Bad response' }));
        if (!res.ok || !data.ok) {
          if (res.status === 401) {
            setError(t('signInToReport'));
          } else {
            setError(data.error ?? t('reportError'));
          }
          return;
        }
        setSubmitted(true);
      } catch {
        setError(t('reportError'));
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className="lb-comment-report__trigger"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        {t('report')}
      </button>
    );
  }

  return (
    <form
      id={formId}
      className="lb-comment-report"
      onSubmit={onSubmit}
    >
      <label htmlFor={`${formId}-reason`} className="lb-comment-report__label">
        {t('reportReasonLabel')}
      </label>
      <textarea
        id={`${formId}-reason`}
        className="lb-comment-report__textarea"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('reportReasonPlaceholder')}
        maxLength={MAX_REASON + 50}
      />
      <div className="lb-comment-report__bar">
        <span
          className={`lb-comment-report__count${tooLong ? ' lb-comment-report__count--over' : ''}`}
        >
          {t('charCount', { count: trimmed.length, max: MAX_REASON })}
        </span>
        {error ? (
          <span className="lb-comment-report__error" role="alert">
            {error}
          </span>
        ) : null}
        <div className="lb-comment-report__actions">
          <button
            type="button"
            className="lb-btn lb-btn--sm lb-btn--ghost"
            onClick={() => {
              setOpen(false);
              setReason('');
              setError(null);
            }}
            disabled={isPending}
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="lb-btn lb-btn--sm lb-btn--primary"
            disabled={tooShort || tooLong || isPending}
          >
            {isPending ? t('submitting') : t('reportSubmit')}
          </button>
        </div>
      </div>
    </form>
  );
}