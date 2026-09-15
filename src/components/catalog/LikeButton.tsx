'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toggleLikeAction } from '@/lib/actions/like';

/**
 * Like button for /l/[giftId] (M-C, OOP-4275).
 *
 * Three render modes — mirrors the FollowButton pattern:
 *   • loading  : SSR-safe placeholder (no layout shift on hydration).
 *   • anon     : link to /login?next=<listing-url>.
 *   • authed   : toggle button. Optimistic update on click; rolls back
 *                if the server action returns an error.
 *
 * `initialLiked` is read from the SSR'd page so an authed user who
 * already liked the gift sees the "Liked" state on first paint — no
 * client-side roundtrip to learn it.
 */
type Mode = 'loading' | 'anon' | 'authed';

type MeResponse = { authed: boolean; userId: string | null };

type Props = {
  giftId: string;
  initialLiked: boolean;
  initialLikeCount: number;
};

export function LikeButton({ giftId, initialLiked, initialLikeCount }: Props) {
  const t = useTranslations('Catalog.likeButton');
  const [mode, setMode] = useState<Mode>('loading');
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialLikeCount);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
      .then((data) => {
        if (cancelled || !data) {
          setMode('anon');
          return;
        }
        setMode(data.authed ? 'authed' : 'anon');
      })
      .catch(() => {
        if (!cancelled) setMode('anon');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onToggle() {
    if (mode !== 'authed' || isPending) return;
    const next = !liked;
    const previousCount = count;
    setLiked(next);
    setCount(next ? previousCount + 1 : Math.max(0, previousCount - 1));
    setError(null);

    startTransition(async () => {
      const result = await toggleLikeAction({ giftId });
      if (!result.ok) {
        setLiked(!next);
        setCount(previousCount);
        setError(t('error'));
        return;
      }
      // Authoritative count from the server (covers concurrent likes).
      setCount(result.likeCount);
      setLiked(result.liked);
    });
  }

  if (mode === 'loading') {
    return (
      <span
        className="lb-btn lb-btn--sm lb-btn--ghost"
        data-loading="true"
        aria-hidden="true"
      >
        ♥ {count}
      </span>
    );
  }

  if (mode === 'anon') {
    return (
      <Link
        className="lb-btn lb-btn--sm lb-btn--ghost"
        href={`/login?next=${encodeURIComponent(`/l/${giftId}`)}`}
      >
        ♥ {count}
        <span className="lb-like-button__hint">{t('signIn')}</span>
      </Link>
    );
  }

  return (
    <span className="lb-like-button">
      <button
        type="button"
        className={`lb-btn lb-btn--sm ${liked ? 'lb-like-button--liked' : 'lb-btn--ghost'}`}
        onClick={onToggle}
        disabled={isPending}
        aria-pressed={liked}
      >
        ♥ {count}
      </button>
      {error ? <span className="lb-like-button__error">{error}</span> : null}
    </span>
  );
}
