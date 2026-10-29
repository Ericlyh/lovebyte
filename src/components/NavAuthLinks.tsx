'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { signOutAction } from '@/lib/actions/auth';
import { LanguageToggle } from '@/components/LanguageToggle';
import { NavMenuMobile, type NavMenuItem } from '@/components/NavMenuMobile';

/**
 * The nav's link set — the auth-dependent half, plus the public "Browse".
 *
 * OOP-6710 — the landing page is prerendered once per locale, so nothing in
 * its tree may read a cookie. That rules out the server-side `auth.getUser()`
 * that used to live in `Nav.tsx`: reading the session cookie is exactly what
 * makes a route dynamic, and it was the last thing keeping `/` server-rendered.
 *
 * So the two nav variants are resolved in two different places:
 *
 *   • `items` given → the server already read the session (every page that is
 *     server-rendered anyway). Render them as-is: no flash, no extra request.
 *   • `items` null  → the page is static, so the client resolves the session
 *     from `/api/me` and fills the slot in. The nav is briefly empty rather
 *     than briefly WRONG — a signed-in visitor never sees "Sign in" on a page
 *     they are already signed in to.
 *
 * OOP-6712 — "Browse" is NOT auth-dependent. The catalogue is public, so
 * that link is rendered for every visitor, and because the session lookup
 * above is client-side it is the one link that reaches a crawler (and a
 * visitor without JS) in the server HTML.
 *
 * "View profile" points at `/u/me` (the redirect shim that resolves to
 * `/u/<handle>`, or to `/onboarding` when the profile has no handle yet)
 * because the client does not know the handle. The server-rendered nav still
 * links straight at `/u/<handle>`.
 */
export function NavAuthLinks({ items }: { items: NavMenuItem[] | null }) {
  const t = useTranslations('Nav');
  const tLanding = useTranslations('Landing.nav');

  // null until the client has resolved the session (static pages only).
  const [session, setSession] = useState<{ authed: boolean } | null>(null);

  useEffect(() => {
    if (items) return;
    let cancelled = false;
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSession({ authed: Boolean(data?.authed) });
      })
      .catch(() => {
        // A failed lookup means we cannot prove the visitor is signed in —
        // show them the signed-out nav rather than guessing.
        if (!cancelled) setSession({ authed: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const resolved: NavMenuItem[] =
    items ??
    (session
      ? session.authed
        ? [
            { kind: 'link', href: '/create', label: t('create') },
            { kind: 'link', href: '/u/me', label: t('viewProfile') },
            { kind: 'signout', label: t('signOut') },
          ]
        : [
            { kind: 'link', href: '/login', label: tLanding('signin') },
            { kind: 'link', href: '/signup', label: tLanding('startFree'), primary: true },
          ]
      : []);

  // OOP-6712 — "Browse" is public: the catalogue is readable by anyone,
  // so the link belongs to every visitor, signed in or not. It is also
  // the one link that is NOT auth-dependent, so it is rendered here for
  // everyone — including in the server HTML, which is what a crawler
  // (or a visitor without JS) sees. The session lookup above is
  // client-side, so the links it decides on only arrive after hydration.
  const navItems: NavMenuItem[] = [
    { kind: 'link', href: '/browse', label: t('browse') },
    ...resolved,
  ];

  return (
    <>
      <div className="lb-nav__links lb-nav__links--desktop">
        {navItems.map((item, i) => {
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
        <NavMenuMobile items={navItems} />
      </div>
    </>
  );
}
