'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ReplyForm } from '@/components/catalog/ReplyForm';
import {
  deleteGiftReplyAction,
  type CreatedGiftReply,
} from '@/lib/actions/giftReplies';
import type { CatalogListingReply } from '@/lib/catalog';

/**
 * Threaded reply section for /l/[giftId] (M-G, OOP-4890).
 *
 * Buyer-question threads on the listing. Distinct from comments (M-D):
 *   - replies nest via `parent_reply_id` (up to 2 levels deep in the UI)
 *   - the gift's creator can prune their own thread (not just their
 *     own messages) — see RLS `gift_replies_delete_own_or_creator`
 *   - sub-replies are rendered inline under their parent
 *
 * Client component because it owns the optimistic tree and the
 * "reply to this question" inline composer. The first page is SSR'd
 * by the server page (calls `getListingReplies`), hydration swaps it
 * into the local list. Any new replies added are kept in the local
 * tree until a hard reload, when the SSR pass picks them up via
 * `revalidatePath('/l/<giftId>')` inside `createGiftReplyAction`.
 */

type MeResponse = { authed: boolean; userId: string | null };

type Props = {
  giftId: string;
  giftOwnerId: string;
  initialReplies: CatalogListingReply[];
  initialTotalCount: number;
  initialHasMore: boolean;
  initialNextCursor: string | null;
};

type ApiPage = {
  replies: CatalogListingReply[];
  nextCursor: string | null;
  totalCount: number;
};

type ReplyNode = CatalogListingReply & {
  children: ReplyNode[];
};

const MAX_DEPTH = 1; // top-level questions; sub-replies are leaves.

function buildTree(rows: CatalogListingReply[]): ReplyNode[] {
  const byId = new Map<string, ReplyNode>();
  for (const r of rows) {
    byId.set(r.id, { ...r, children: [] });
  }
  const roots: ReplyNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id);
    if (!node) continue;
    if (r.parent_reply_id && byId.has(r.parent_reply_id)) {
      byId.get(r.parent_reply_id)!.children.push(node);
    } else {
      // Orphan (parent_reply_id points to a row we haven't loaded —
      // possible across page boundaries) or top-level: render as root.
      roots.push(node);
    }
  }
  return roots;
}

export function ListingReplies({
  giftId,
  giftOwnerId,
  initialReplies,
  initialTotalCount,
  initialHasMore,
  initialNextCursor,
}: Props) {
  const t = useTranslations('Catalog.replies');
  const [replies, setReplies] =
    useState<CatalogListingReply[]>(initialReplies);
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
  const [activeReplyTo, setActiveReplyTo] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();

  const tree = useMemo(() => buildTree(replies), [replies]);

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

  const handleCreated = useCallback((reply: CreatedGiftReply) => {
    setReplies((prev) => {
      // Avoid double-inserts if the SSR pass somehow already saw the row.
      if (prev.some((r) => r.id === reply.id)) return prev;
      return [...prev, reply];
    });
    setTotalCount((n) => n + 1);
    setActiveReplyTo(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(
        `/api/gift-replies/${giftId}?cursor=${encodeURIComponent(nextCursor)}`,
        { cache: 'no-store' },
      );
      const data: ApiPage = await res
        .json()
        .catch(() => ({ replies: [], nextCursor: null, totalCount: 0 }));
      if (!res.ok) {
        setLoadMoreError(t('loadMoreError'));
        return;
      }
      setReplies((prev) => [...prev, ...data.replies]);
      setTotalCount(data.totalCount);
      setNextCursor(data.nextCursor);
      setHasMore(data.nextCursor != null);
    } catch {
      setLoadMoreError(t('loadMoreError'));
    } finally {
      setLoadingMore(false);
    }
  }, [giftId, hasMore, loadingMore, nextCursor, t]);

  function onDelete(replyId: string) {
    if (deletingId) return;
    setDeletingId(replyId);
    startDeleteTransition(async () => {
      const result = await deleteGiftReplyAction({ replyId });
      if (!result.ok) {
        setDeletingId(null);
        return;
      }
      setReplies((prev) => prev.filter((r) => r.id !== replyId));
      setTotalCount((n) => Math.max(0, n - 1));
      setDeletingId(null);
    });
  }

  function renderAuthor(
    user: CatalogListingReply['user'],
        isAuthor: boolean,
        isCreator: boolean,
    ) {
    return (
      <p className="lb-listing-replies__author">
        {user.handle ? (
          <Link href={`/u/${user.handle}`} className="lb-link">
            {user.display_name ?? `@${user.handle}`}
          </Link>
        ) : (
          user.display_name ?? t('you')
        )}
        {isCreator ? (
          <span className="lb-listing-replies__creator-badge">
            {t('creator')}
          </span>
        ) : null}
      </p>
    );
  }

  function renderNode(node: ReplyNode, depth: number): React.ReactNode {
    const isAuthor =
      authReady && authed && viewerId === node.user.id;
    const isCreator = viewerId === giftOwnerId;
    const canDelete = authReady && authed && (isAuthor || isCreator);
    const canReply =
      authReady &&
      authed &&
      // Allow sub-replies only at the top level (depth 0). Sub-replies
      // to sub-replies would push the nesting past the design's intended
      // 2-level limit; the server doesn't enforce this (parent_reply_id
      // is free), so the UI keeps the contract.
      depth === 0 &&
      activeReplyTo !== node.id;
    return (
      <li
        key={node.id}
        className={`lb-listing-replies__item lb-listing-replies__item--depth-${depth}`}
      >
        <div className="lb-listing-replies__row">
          {renderAuthor(node.user, isAuthor, isCreator)}
          {canDelete ? (
            <button
              type="button"
              className="lb-listing-replies__delete"
              onClick={() => onDelete(node.id)}
              disabled={deletingId === node.id}
            >
              {deletingId === node.id ? t('deleting') : t('delete')}
            </button>
          ) : null}
        </div>
        <p className="lb-listing-replies__body">{node.body}</p>
        {canReply ? (
          <button
            type="button"
            className="lb-btn lb-btn--sm lb-btn--ghost lb-listing-replies__reply-cta"
            onClick={() => setActiveReplyTo(node.id)}
          >
            {t('replyCta')}
          </button>
        ) : null}
        {activeReplyTo === node.id ? (
          <div className="lb-listing-replies__reply-form">
            <ReplyForm
              giftId={giftId}
              parentReplyId={node.id}
              onCreated={handleCreated}
              onCancel={() => setActiveReplyTo(null)}
            />
          </div>
        ) : null}
        {node.children.length > 0 ? (
          <ul className="lb-listing-replies__children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  return (
    <section
      className="lb-listing-replies"
      aria-labelledby="lb-listing-replies-heading"
    >
      <h2
        id="lb-listing-replies-heading"
        className="lb-listing-replies__heading"
      >
        {t('heading', { count: totalCount })}
      </h2>
      <p className="lb-listing-replies__lede">{t('lede')}</p>

      <ReplyForm giftId={giftId} onCreated={handleCreated} />

      {tree.length === 0 ? (
        <div className="lb-empty-card lb-empty-card--inline" role="status">
          <p className="lb-empty-card__body">{t('empty')}</p>
        </div>
      ) : (
        <ul className="lb-listing-replies__list">
          {tree.map((node) => renderNode(node, 0))}
        </ul>
      )}

      {hasMore ? (
        <div className="lb-listing-replies__more">
          <button
            type="button"
            className="lb-btn lb-btn--sm lb-btn--ghost"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </button>
          {loadMoreError ? (
            <p className="lb-listing-replies__error" role="alert">
              {loadMoreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}