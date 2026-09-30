'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { signOutAction } from '@/lib/actions/auth';
import { LanguageToggle } from '@/components/LanguageToggle';

export type NavMenuItem =
  | { kind: 'link'; href: string; label: string; primary?: boolean }
  | { kind: 'signout'; label: string };

/**
 * Mobile hamburger + slide-out side menu (OOP-5420 follow-up).
 *
 * The previous mobile nav was a `flex-wrap` row that stacked links onto
 * two or three lines on a phone, which the user (lDisUa5d…) called
 * "ugly". They asked for a hamburger that pops out a side menu listing
 * the items vertically.
 *
 * Hidden at ≥640px via CSS — the desktop horizontal links stay in
 * `.lb-nav__links`. Below 640px we swap: hide the row, show the
 * hamburger, and let the drawer take over.
 *
 * Auth state is decided in the server-component parent (`Nav.tsx`); this
 * client component just renders whatever items it is given. The
 * `<LanguageToggle />` lives at the bottom of the drawer so it stays
 * accessible without crowding the brand row.
 */
export function NavMenuMobile({ items }: { items: NavMenuItem[] }): ReactNode {
  const [open, setOpen] = useState(false);

  // Close on Escape, and lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // The hamburger button lives inside <nav className="lb-nav">, which has
  // `backdrop-filter: blur(12px)` for the sticky-blur effect. backdrop-filter
  // turns the nav into the containing block for fixed-positioned descendants,
  // so a plain `position: fixed; inset: 0` drawer collapses to the nav's own
  // ~72px height and the nav list renders below the visible panel. Portal
  // the drawer into document.body so `inset: 0` resolves against the
  // viewport again. (Discovered 2026-09-30 via headless Chrome: the drawer's
  // getBoundingClientRect().height was 72 — exactly the nav bar height.)
  const drawer = open ? (
    <div
      id="lb-mobile-drawer"
      className="lb-mobile-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
    >
      <div
        className="lb-mobile-drawer__scrim"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <aside className="lb-mobile-drawer__panel">
        <button
          type="button"
          className="lb-mobile-drawer__close"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        >
          <span aria-hidden="true">×</span>
        </button>
        <nav className="lb-mobile-drawer__nav" aria-label="Primary">
          <ul className="lb-mobile-drawer__list">
            {items.map((item, i) => {
              if (item.kind === 'link') {
                return (
                  <li key={`${item.href}-${i}`}>
                    <Link
                      href={item.href}
                      className={
                        item.primary
                          ? 'lb-mobile-drawer__link lb-mobile-drawer__link--primary'
                          : 'lb-mobile-drawer__link'
                      }
                      onClick={() => setOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              }
              return (
                <li key="signout">
                  <form action={signOutAction} className="lb-mobile-drawer__signout-form">
                    <button type="submit" className="lb-mobile-drawer__link lb-mobile-drawer__link--ghost">
                      {item.label}
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
          <div className="lb-mobile-drawer__lang">
            <LanguageToggle />
          </div>
        </nav>
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        className="lb-nav__menu-button"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="lb-mobile-drawer"
        onClick={() => setOpen((v) => !v)}
      >
        {/* Three-line hamburger. The lines stay present in the DOM
            so screen readers see a stable icon-button label rather
            than a glyph that swaps under them. */}
        <span className="lb-nav__menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {typeof document !== 'undefined' && drawer
        ? createPortal(drawer, document.body)
        : null}
    </>
  );
}
