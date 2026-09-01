import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { signOutAction } from '@/lib/actions/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Shared top nav (M-B follow-up, OOP-4310).
 *
 * Server component. Reads auth state once per render and picks the
 * link set accordingly:
 *
 *   Anon   → brand · lang toggle · "Sign in" · "Start free" CTA
 *   Authed → brand · lang toggle · "View profile" · Sign-out form
 *
 * The Sign-out is a `<form action={signOutAction}>` so it works without
 * JS (server action clears the cookie and redirects to `/`).
 *
 * Mounted by /onboarding, /u/[handle], and /settings — three authed-
 * adjacent pages that previously each defined their own nav inline.
 * The landing page keeps its own inline nav (it has different copy).
 */
export async function Nav() {
  const t = await getTranslations('Nav');
  const tLanding = await getTranslations('Landing.nav');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let handle: string | null = null;
  if (user) {
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('handle')
      .eq('id', user.id)
      .maybeSingle();
    handle = (profileRow?.handle as string | null) ?? null;
  }

  return (
    <nav className="lb-nav">
      <Link href="/" className="lb-nav__brand">{t('brand')}</Link>
      <div className="lb-nav__links">
        <LanguageToggle />
        {user ? (
          <>
            {handle ? (
              <Link href={`/u/${handle}`}>{t('viewProfile')}</Link>
            ) : (
              <Link href="/onboarding">{t('finishProfile')}</Link>
            )}
            <form action={signOutAction} className="lb-nav__signout-form">
              <button type="submit" className="lb-btn lb-btn--ghost lb-btn--sm">
                {t('signOut')}
              </button>
            </form>
          </>
        ) : (
          <>
            <Link href="/login">{tLanding('signin')}</Link>
            <Link href="/signup" className="lb-btn lb-btn--primary lb-btn--sm">
              {tLanding('startFree')}
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
