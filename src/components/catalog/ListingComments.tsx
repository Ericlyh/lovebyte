'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { CommentReportButton } from '@/components/catalog/CommentReportButton';
import { CommentForm } from '@/components/catalog/CommentForm';
import {
  deleteCommentAction,
  type CreatedComment,
} from '@/lib/actions/comments';
import type { CatalogListingComment } from '@/lib/catalog';

/**
 * Full comment thread for /l/[giftId] (M-D, OOP-4276).
 *
 * Client component so we can:
 *   - render a `CommentForm` (auth-gated) above the thread
 *   - append optimistic rows from `createCommentAction`
 *   - paginate via "Load more" → `GET /api/gift-comments/[giftId]`
 *   - soft-delete a comment via `deleteCommentAction` (RLS scopes
 *     the update to `auth.uid() = author_id`)
 *   - hide the row from the local list when the viewer deletes their
 *     own comment (the public RLS already filters `deleted_at is null`
 *     on subsequent fetches)
 *
 * The first 10 comments are SSR'd in by the server page so anon
 * visitors see real comments on first paint; hydration swaps them
 * into the local list. Any new ones added by the viewer are kept in
 * the local list until a hard reload, when the SSR pass picks them
 * up via `revalidatePath('/l/<giftId>')` inside `createCommentAction`.
 */

type MeResponse = { authed: boolean; userId: string | null };

type Props = {
  giftId: string;
  initialComments: CatalogListingComment[];
  initialTotalCount: number;
  initialHasMore: boolean;
  initialNextCursor: string | null;
};

type ApiPage = {
  comments: CatalogListingComment[];
  nextCursor: string | null;
  totalCount: number;
};

export function ListingComments({
  giftId,
  initialComments,
  initialTotalCount,
  initialHasMore,
  initialNextCursor,
}: Props) {
  const t = useTranslations('Catalog.comments');
  const [comments, setComments] = useState<CatalogListingComment[]>(initialComments);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [nextCursor, setNextCursor] = useState<string | null>(
    initialNextCursor,
  );
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
      .then((data) => {
        if (cancelled || !data) {
          setAuthReady(true);
          return;
        }
        setAuthed(data.authed);
        setViewerId(data.userId);
        setAuthReady(true);
      })
      .catch(() => {
        if (!cancelled) setAuthReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreated = useCallback((comment: CreatedComment) => {
    setComments((prev) => {
      // Avoid double-inserts if the SSR pass somehow already saw the row.
      if (prev.some((c) => c.id === comment.id)) return prev;
      return [...prev, comment];
    });
    setTotalCount((n) => n + 1);
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(
        `/api/gift-comments/${giftId}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: 'no-store' },
      );
      const data: ApiPage = await res
        .json()
        .catch(() => ({ comments: [], nextCursor: null, totalCount: 0 }));
      if (!res.ok) {
        setLoadMoreError(t('loadMoreError'));
        return;
      }
      setComments((prev) => [...prev, ...data.comments]);
      setTotalCount(data.totalCount);
      setNextCursor(data.nextCursor);
      setHasMore(data.nextCursor != null);
    } catch {
      setLoadMoreError(t('loadMoreError'));
    } finally {
      setLoadingMore(false);
    }
  }, [giftId, hasMore, loadingMore, nextCursor, t]);

  function onDelete(commentId: string) {
    if (deletingId) return;
    setDeletingId(commentId);
    startDeleteTransition(async () => {
      const result = await deleteCommentAction({ commentId });
      if (!result.ok) {
        setDeletingId(null);
        // Keep the row visible on failure; the server action already
        // logged the underlying error.
        return;
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      setTotalCount((n) => Math.max(0, n - 1));
      setDeletingId(null);
    });
  }

  return (
    <section
      className="lb-listing-comments"
      aria-labelledby="lb-listing-comments-heading"
    >
      <h2
        id="lb-listing-comments-heading"
        className="lb-listing-comments__heading"
      >
        {t('heading', { count: totalCount })}
      </h2>

      <CommentForm giftId={giftId} onCreated={handleCreated} />

      {comments.length === 0 ? (
        <div className="lb-empty-card lb-empty-card--inline" role="status">
          <p className="lb-empty-card__body">{t('empty')}</p>
        </div>
      ) : (
        <ul className="lb-listing-comments__list">
          {comments.map((c) => {
            const isAuthor = authReady && authed && viewerId === c.author.id;
            const showReport = authReady && authed && !isAuthor;
            return (
              <li key={c.id} className="lb-listing-comments__item">
                <div className="lb-listing-comments__row">
                  <p className="lb-listing-comments__author">
                    {c.author.handle ? (
                      <Link href={`/u/${c.author.handle}`} className="lb-link">
                        {c.author.display_name ?? `@${c.author.handle}`}
                      </Link>
                    ) : (
                      c.author.display_name ?? t('you')
                    )}
                  </p>
                  {isAuthor ? (
                    <button
                      type="button"
                      className="lb-listing-comments__delete"
                      onClick={() => onDelete(c.id)}
                      disabled={deletingId === c.id}
                    >
                      {deletingId === c.id ? t('deleting') : t('delete')}
                    </button>
                  ) : null}
                </div>
                <p className="lb-listing-comments__body">{c.body}</p>
                {showReport ? (
                  <CommentReportButton commentId={c.id} authed={showReport} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore ? (
        <div className="lb-listing-comments__more">
          <button
            type="button"
            className="lb-btn lb-btn--sm lb-btn--ghost"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </button>
          {loadMoreError ? (
            <p className="lb-listing-comments__error" role="alert">
              {loadMoreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}