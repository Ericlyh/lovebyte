import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { signOutAction } from '@/lib/actions/auth';
import { createClient } from '@/lib/supabase/server';
import { LanguageToggle } from '@/components/LanguageToggle';
import { NavMenuMobile, type NavMenuItem } from '@/components/NavMenuMobile';

/**
 * Shared top nav (M-B follow-up, OOP-4310).
 *
 * Server component. Reads auth state once per render and picks the
 * link set accordingly:
 *
 *   Anon   → brand · lang toggle · "Sign in" · "Start free" CTA
 *   Authed → brand · lang toggle · "Browse" · "Create" · "View profile" · Sign-out form
 *
 * Desktop renders the items in a single horizontal row. Below 640px
 * the row is hidden by CSS and a hamburger pops out a side drawer
 * instead (OOP-5420 follow-up — the user called the wrapping row
 * "ugly on mobile"). Both render the same items, sourced from
 * `items[]` below so the two views can never drift.
 *
 * The Sign-out is a `<form action={signOutAction}>` so it works
 * without JS (server action clears the cookie and redirects to `/`).
 *
 * Mounted by /, /onboarding, /u/[handle], /settings, and /create — the
 * pages that previously each defined their own nav inline.
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

  const items: NavMenuItem[] = user
    ? [
        { kind: 'link', href: '/browse', label: t('browse') },
        { kind: 'link', href: '/create', label: t('create') },
        ...(handle
          ? [{ kind: 'link' as const, href: `/u/${handle}`, label: t('viewProfile') }]
          : [{ kind: 'link' as const, href: '/onboarding', label: t('finishProfile') }]),
        { kind: 'signout', label: t('signOut') },
      ]
    : [
        { kind: 'link', href: '/login', label: tLanding('signin') },
        { kind: 'link', href: '/signup', label: tLanding('startFree'), primary: true },
      ];

  return (
    <nav className="lb-nav">
      <Link href="/" className="lb-nav__brand">{t('brand')}</Link>
      <div className="lb-nav__links lb-nav__links--desktop">
        {items.map((item, i) => {
          if (item.kind === 'link') {
            return (
              <Link
                key={`${item.href}-${i}`}
                href={item.href}
                className={item.primary ? 'lb-btn lb-btn--primary lb-btn--sm' : undefined}
              >
                {item.label}
              </Link>
            );
          }
          return (
            <form key="signout" action={signOutAction} className="lb-nav__signout-form">
              <button type="submit" className="lb-btn lb-btn--ghost lb-btn--sm">
                {item.label}
              </button>
            </form>
          );
        })}
        <LanguageToggle />
      </div>
      <div className="lb-nav__links--mobile">
        <NavMenuMobile items={items} />
      </div>
    </nav>
  );
}
