import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { LanguageToggle } from '@/components/LanguageToggle';
import {
  getProfileByHandle,
  getRedirectForOldHandle,
} from '@/lib/profiles/query';
import { HANDLE_REGEX, HANDLE_MAX_LENGTH } from '@/lib/profiles/handle';

/**
 * /u/[handle] — public creator profile (OOP-4274 M-B).
 *
 * Edge-runtime safe: data fetch goes through `profiles_public`
 * (anon-readable view from M-A). The authed follow action lands in
 * the next heartbeat (OOP-4280) — for now the page is read-only.
 *
 * **Handle-change redirect (OOP-4284 Part C):** if the requested
 * handle doesn't exist in `profiles_public`, we look up
 * `handle_history.old_handle` and 301-redirect to the new handle so
 * stale links keep working after a rename.
 *
 * The handle param is validated here as a 404 guard before we touch
 * the DB. The DB-side CHECK constraint is the source of truth; this
 * guard just keeps us from echoing malformed handles back to the URL.
 */
type Props = {
  params: Promise<{ handle: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  const name = profile?.display_name ?? `@${handle}`;
  return {
    title: `${name} — LoveByte`,
    description: profile?.bio ?? `Creator profile @${handle} on LoveByte.`,
  };
}

export default async function CreatorProfilePage({ params }: Props) {
  const { handle } = await params;

  // Reject malformed handles with a 404 rather than 500. Mirrors the
  // DB CHECK constraint — if the handle passes this regex it would
  // round-trip the profiles_public view safely.
  if (
    !handle ||
    handle.length < 3 ||
    handle.length > HANDLE_MAX_LENGTH ||
    !HANDLE_REGEX.test(handle)
  ) {
    notFound();
  }

  const profile = await getProfileByHandle(handle);
  if (!profile) {
    // Handle changed at some point. Look up the history and 301 to
    // the new handle. If no history row exists, it's a real 404.
    const redirectTarget = await getRedirectForOldHandle(handle);
    if (redirectTarget) {
      redirect(`/u/${redirectTarget.newHandle}`);
    }
    notFound();
  }

  const t = await getTranslations('Profile');
  const displayName = profile.display_name ?? `@${profile.handle}`;
  const links = Array.isArray(profile.links)
    ? (profile.links as unknown[]).filter(
        (l): l is string => typeof l === 'string' && /^https?:\/\//.test(l),
      )
    : [];

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">LoveByte</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
          <Link href="/signup" className="lb-btn lb-btn--primary lb-btn--sm">
            {t('joinCta')}
          </Link>
        </div>
      </nav>

      <section className="lb-profile-hero">
        <h1>{displayName}</h1>
        <p className="lb-profile-handle">@{profile.handle}</p>
        {profile.bio ? <p className="lede">{profile.bio}</p> : null}
        {links.length > 0 ? (
          <ul className="lb-profile-links">
            {links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="lb-profile-follow-stub">
          {/* Follow action lands in OOP-4280. Stub copy keeps the layout locked. */}
          {t('followPlaceholder')}
        </p>
      </section>

      <section className="lb-profile-tabs" aria-label={t('tabsAria')}>
        <button type="button" className="lb-tab lb-tab--active">
          {t('collection')}
        </button>
        <button type="button" className="lb-tab">
          {t('about')}
        </button>
      </section>

      <section className="lb-profile-collection">
        <p className="lb-empty">{t('emptyCollection')}</p>
      </section>
    </main>
  );
}
