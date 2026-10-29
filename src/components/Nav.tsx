import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { NavAuthLinks } from '@/components/NavAuthLinks';
import { type NavMenuItem } from '@/components/NavMenuMobile';

/**
 * Shared top nav (M-B follow-up, OOP-4310).
 *
 * Server component. Reads auth state once per render and picks the
 * link set accordingly:
 *
 *   Anon   → brand · lang toggle · "Browse" · "Sign in" · "Start free" CTA
 *   Authed → brand · lang toggle · "Browse" · "Create" · "View profile" · Sign-out form
 *
 * "Browse" is not in either list: the catalogue is public, so that link
 * is rendered for every visitor by <NavAuthLinks /> (OOP-6712).
 *
 * Desktop renders the items in a single horizontal row. Below 640px
 * the row is hidden by CSS and a hamburger pops out a side drawer
 * instead (OOP-5420 follow-up — the user called the wrapping row
 * "ugly on mobile"). Both render the same items, sourced from the
 * `items[]` below so the two views can never drift.
 *
 * The Sign-out is a `<form action={signOutAction}>` so it works
 * without JS (server action clears the cookie and redirects to `/`).
 *
 * Mounted by /, /onboarding, /u/[handle], /settings, and /create — the
 * pages that previously each defined their own nav inline.
 *
 * OOP-6710 — `deferAuth` hands the session lookup to the client instead of
 * reading the auth cookie here. Reading a cookie is what makes a route
 * dynamic, and the landing page has to be prerendered once per locale (its
 * cold boot was 4 s). The landing page is the only caller; every other page
 * is server-rendered anyway, so it keeps the cookie read and pays no
 * client-side round trip.
 */
export async function Nav({ deferAuth = false }: { deferAuth?: boolean } = {}) {
  const t = await getTranslations('Nav');
  const tLanding = await getTranslations('Landing.nav');

  let items: NavMenuItem[] | null = null;

  if (!deferAuth) {
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

    items = user
      ? [
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
  }

  return (
    <nav className="lb-nav">
      <Link href="/" className="lb-nav__brand">{t('brand')}</Link>
      <NavAuthLinks items={items} />
    </nav>
  );
}
