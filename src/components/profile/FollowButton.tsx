'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

/**
 * FollowButton — the authed-side of the follow action on /u/[handle].
 *
 * On mount, probes GET /api/me to learn the current session. Four
 * render modes:
 *
 *   - `loading`     : while we don't know yet (avoids layout shift)
 *   - `anon`        : renders a "Sign in to follow @handle" link to /login
 *   - `self`        : visiting your own profile — button is disabled
 *   - `authed`      : toggle button. Optimistic update on click; rolls
 *                     back if the server returns an error.
 *
 * M-D (OOP-4276) extends this with `initialFollowerCount`: we show
 * the count next to the button and optimistically increment / decrement
 * on toggle. The parent /u/[handle] page also reads this count via
 * SSR; the optimistic local value is the source of truth between
 * page navigations, while a `router.refresh()` after a successful
 * toggle brings the SSR count back in sync.
 *
 * Self-follow is impossible here because /u/[handle] only renders when
 * the profile lookup succeeded for a *different* handle than the
 * signed-in user's own handle — but we still pass `viewerId` down so
 * the UI could short-circuit the button if M-D ever wants to ship a
 * "this is you" stub.
 */

type Mode = 'loading' | 'anon' | 'authed' | 'self';

type Props = {
  /** The creator being followed (UUID). */
  creatorId: string;
  /** Their handle, used for the i18n string. */
  handle: string;
  /** SSR'd follower count for the creator. Drives the optimistic
   *  update on toggle (M-D acceptance: "Follow count updates on the
   *  creator profile after the follow button is clicked"). */
  initialFollowerCount?: number;
  /** The signed-in viewer's UUID, or null. Avoids an /api/me roundtrip
   *  when the parent already has the session (currently unused — kept
   *  for the future self-follow guard). */
  viewerId?: string | null;
};

type MeResponse = { authed: boolean; userId: string | null };

export function FollowButton({
  creatorId,
  handle,
  initialFollowerCount = 0,
  viewerId,
}: Props) {
  const t = useTranslations('Profile.followButton');
  const [mode, setMode] = useState<Mode>('loading');
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
      .then((data) => {
        if (cancelled || !data) {
          // Treat a failed probe as anon — the click on the link will
          // surface the real auth state on /login.
          setMode('anon');
          return;
        }
        if (!data.authed) {
          setMode('anon');
          return;
        }
        if (viewerId && data.userId && data.userId === creatorId) {
          setMode('self');
          return;
        }
        setMode('authed');
      })
      .catch(() => {
        if (!cancelled) setMode('anon');
      });
    return () => {
      cancelled = true;
    };
  }, [creatorId, viewerId]);

  function onToggle() {
    if (mode !== 'authed' || isPending) return;
    const next = !following;
    setFollowing(next);
    // Optimistic count update so the badge next to the button moves
    // immediately. The SSR count re-syncs on the next page navigation.
    setFollowerCount((n) => Math.max(0, n + (next ? 1 : -1)));
    setError(null);

    startTransition(async () => {
      try {
        const res = next
          ? await fetch('/api/creator-follows', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ creator_id: creatorId }),
            })
          : await fetch(`/api/creator-follows/${creatorId}`, {
              method: 'DELETE',
            });
        const data: { ok: boolean; error?: string } = await res
          .json()
          .catch(() => ({ ok: false, error: 'Bad response' }));
        if (!res.ok || !data.ok) {
          setFollowing(!next);
          setFollowerCount((n) => Math.max(0, n + (next ? -1 : 1)));
          setError(data.error ?? t('error'));
        }
      } catch {
        setFollowing(!next);
        setFollowerCount((n) => Math.max(0, n + (next ? -1 : 1)));
        setError(t('error'));
      }
    });
  }

  if (mode === 'loading') {
    // Reserve the same vertical space so the hero doesn't jump when
    // the mode resolves.
    return (
      <p className="lb-profile-follow" aria-hidden="true">
        <span className="lb-btn lb-btn--sm lb-btn--ghost" data-loading="true">
          {t('loading')}
        </span>
      </p>
    );
  }

  if (mode === 'anon') {
    return (
      <p className="lb-profile-follow">
        <Link
          className="lb-btn lb-btn--sm lb-btn--primary"
          href={`/login?next=${encodeURIComponent(`/u/${handle}`)}`}
        >
          {t('signIn', { handle })}
        </Link>
      </p>
    );
  }

  if (mode === 'self') {
    return (
      <p className="lb-profile-follow">
        <span className="lb-btn lb-btn--sm lb-btn--ghost" aria-disabled="true">
          {t('self')}
        </span>
      </p>
    );
  }

  return (
    <p className="lb-profile-follow">
      <button
        type="button"
        className={
          following
            ? 'lb-btn lb-btn--sm lb-btn--ghost'
            : 'lb-btn lb-btn--sm lb-btn--primary'
        }
        onClick={onToggle}
        disabled={isPending}
        aria-pressed={following}
      >
        {isPending ? t('submitting') : following ? t('unfollow') : t('follow')}
      </button>
      <span className="lb-profile-follow__count" aria-live="polite">
        {followerCount}
      </span>
      {error ? <span className="lb-profile-follow__error">{error}</span> : null}
    </p>
  );
}
