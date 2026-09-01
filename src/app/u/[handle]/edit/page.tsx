import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import {
  ProfileEditForm,
  ProfileEditSignOut,
} from '@/components/auth/ProfileEditForm';
import { createClient } from '@/lib/supabase/server';
import { HANDLE_REGEX, HANDLE_MAX_LENGTH } from '@/lib/profiles/handle';

export const metadata: Metadata = {
  title: 'Edit your profile — LoveByte',
};

/**
 * /u/[handle]/edit — profile edit UI (OOP-4340, M-B step 3c).
 *
 * Authed-only server component. Flow:
 *
 *   1. `supabase.auth.getUser()` → null → redirect to
 *      /login?reason=auth_refresh_failed. The `reason` param is the
 *      signal the login page can render a hint from if we wire it
 *      later — for now it just survives the bounce.
 *   2. Look up the user's profile by `user.id` (NOT by the `handle`
 *      URL param — the URL is a vanity mirror, the DB row is the
 *      truth). If the URL handle doesn't match, redirect to the
 *      canonical `/u/<realHandle>/edit` so the back button + bookmarks
 *      stay in sync after a handle rename.
 *   3. Pass the current profile fields + `handle_changed_at` (used as
 *      the 30-day cooldown source of truth by the form) to
 *      `ProfileEditForm`. The form owns the live debounced handle
 *      probe + the submit transitions; the page is just a data shell.
 *
 * Avatar upload is intentionally a TODO — the `avatars` Storage bucket
 * isn't created yet (OOP-4286). The form renders a disabled file input
 * so the layout lines up with /onboarding.
 */
type Props = {
  params: Promise<{ handle: string }>;
};

export default async function ProfileEditPage({ params }: Props) {
  const { handle: handleParam } = await params;
  const t = await getTranslations('Profile.edit');

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    // Anonymous / stale-session visitors. The login page already shows
    // a hint when this reason is present (and ignores it otherwise).
    redirect('/login?reason=auth_refresh_failed');
  }

  // Read by `user.id` — the URL handle is just a vanity mirror.
  // RLS lets the user read their own row.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('handle, display_name, bio, links, handle_changed_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr) {
    console.error('[profile-edit] profile read failed', profileErr.message);
    return (
      <main className="min-h-screen flex flex-col">
        <nav className="lb-nav">
          <Link href="/" className="lb-nav__brand">LoveByte</Link>
          <div className="lb-nav__links">
            <LanguageToggle />
            <ProfileEditSignOut />
          </div>
        </nav>
        <section className="lb-auth-card">
          <h1>{t('heading')}</h1>
          <p role="alert" className="lb-form__error">
            Could not load your profile right now. Refresh the page to try again.
          </p>
        </section>
      </main>
    );
  }

  if (!profile?.handle) {
    // Profile row missing entirely — the auth.users row exists but the
    // handle_new_user trigger didn't seed a public.profiles row. Mirror
    // the /onboarding flow: send the user to set one up.
    redirect('/onboarding');
  }

  // Canonicalise the URL. If the user navigates to /u/<stale>/edit after
  // a rename, bounce them to /u/<current>/edit so the URL in the bar
  // matches the form value.
  if (handleParam !== profile.handle) {
    redirect(`/u/${profile.handle}/edit`);
  }

  // 404 guard for malformed handles. The DB CHECK constraint is the
  // source of truth; this guard just keeps malformed URLs from
  // round-tripping through the authed read.
  if (
    handleParam.length < 3 ||
    handleParam.length > HANDLE_MAX_LENGTH ||
    !HANDLE_REGEX.test(handleParam)
  ) {
    redirect(`/u/${profile.handle}/edit`);
  }

  const initialDisplayName =
    (profile.display_name as string | null) ??
    (user.user_metadata?.display_name as string | null) ??
    '';
  const initialBio = (profile.bio as string | null) ?? '';
  const initialLinks = Array.isArray(profile.links)
    ? (profile.links as unknown[]).filter(
        (l): l is string => typeof l === 'string' && /^https?:\/\//.test(l),
      )
    : [];
  // Form expects an ISO string OR null. handle_changed_at is timestamptz
  // → string already, but we narrow for the caller's benefit.
  const cooldownEndsAt: string | null =
    typeof profile.handle_changed_at === 'string'
      ? profile.handle_changed_at
      : null;

  return (
    <main className="min-h-screen flex flex-col">
      <nav className="lb-nav">
        <Link href="/" className="lb-nav__brand">LoveByte</Link>
        <div className="lb-nav__links">
          <LanguageToggle />
          <ProfileEditSignOut />
        </div>
      </nav>

      <section className="lb-auth-card">
        <h1>{t('heading')}</h1>
        <p className="lede">{t('lede')}</p>

        <ProfileEditForm
          currentHandle={profile.handle}
          currentDisplayName={initialDisplayName}
          currentBio={initialBio}
          currentLinks={initialLinks}
          cooldownEndsAt={cooldownEndsAt}
        />
      </section>
    </main>
  );
}
