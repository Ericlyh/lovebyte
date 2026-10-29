import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Norican, Overlock } from 'next/font/google';
import { hasLocale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CommonNotFound } from '@/components/PageState';
import { BRAND } from '@/lib/brand';
import { routing, type Locale } from '@/lib/i18n/routing';
import './globals.css';

/**
 * OOP-6762 — the app-wide 404 document.
 *
 * WHY THIS FILE EXISTS
 *
 * The root layout of this app is `src/app/[locale]/layout.tsx` (OOP-6710).
 * That is what lets every page be prerendered once per locale instead of
 * once per request — the locale comes from the route param rather than
 * from a cookie, so nothing in the layout reads `headers()`.
 *
 * The cost of that shape is that the ROOT layer of the app tree has no
 * layout at all, and Next renders two kinds of 404 from the root layer:
 *
 *   - a URL that matches no route at all (`/random-404`), and
 *   - any URL whose page calls `notFound()` (`/l/<unknown id>`).
 *
 * With no layout to render, Next emitted its own fallback document —
 * `<html id="__next_error__">` — which carries no `lang` attribute, so
 * every 404 page failed axe's `html-has-lang` rule (WCAG 3.1.1 Language
 * of Page, Level A) and a screen reader had no language to read the
 * page in.
 *
 * Next documents this exact shape — "your root layout is defined using
 * top-level dynamic segments" — as the case `global-not-found.js` exists
 * for. With `experimental.globalNotFound` enabled (see `next.config.ts`),
 * this file owns the 404 document's `<html>` and `<body>`, so the
 * language can be declared per locale. The per-locale prerendering is
 * untouched: this adds a route, it does not move the layout.
 *
 * WHAT THIS DOCUMENT HAS TO BRING ITSELF
 *
 * The document bypasses the app's normal rendering, so it has to import
 * the styles and fonts it needs — the same ones
 * `src/app/[locale]/layout.tsx` loads — or the card renders unstyled.
 */

const norican = Norican({
  weight: '400',
  variable: '--font-lb-display-loaded',
  subsets: ['latin'],
  display: 'swap',
});

const overlock = Overlock({
  weight: ['400', '700', '900'],
  variable: '--font-lb-body-loaded',
  subsets: ['latin'],
  display: 'swap',
});

/**
 * The visitor's locale.
 *
 * `src/proxy.ts` resolves it once per request — the `lb-locale` cookie,
 * then `Accept-Language`, then the default — and forwards it as
 * `X-NEXT-INTL-LOCALE` on the rewritten request. This document is
 * rendered outside the `[locale]` segment, so the route param is not
 * available to it; the forwarded header carries the same value the rest
 * of the site used for this request.
 */
async function resolveLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  const requested = requestHeaders.get('X-NEXT-INTL-LOCALE');
  if (requested && hasLocale(routing.locales, requested)) {
    return requested;
  }
  return routing.defaultLocale;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveLocale();
  setRequestLocale(locale);
  const t = await getTranslations('Common.notFound');
  return {
    title: `${t('title')} · ${BRAND.NAME}`,
    /**
     * A 404 document must never be indexed.
     *
     * Next emits this tag itself, but only when it knows the response
     * status at render time — and on Vercel the 404 is applied AFTER
     * the render, so the tag was missing in production while a local
     * `next start` had it. Declaring it here makes it the same on every
     * platform.
     */
    robots: { index: false },
  };
}

export default async function GlobalNotFound() {
  const locale = await resolveLocale();

  // Tell next-intl which locale this request is in, so the copy below
  // comes from the right message bundle. The document is rendered per
  // request (it reads `headers()`), so this is belt and braces — but it
  // is what makes the locale explicit rather than incidental.
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${norican.variable} ${overlock.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/*
          The same card the per-route `not-found.tsx` files render, so a
          404 reads the same whichever way it was reached. `titleLevel`
          is `h1` because this document has no other heading — the a11y
          gate measures every route for exactly one h1 and a clean
          outline (OOP-6738).
        */}
        <main className="lb-landing-page">
          <CommonNotFound titleLevel="h1" />
        </main>
      </body>
    </html>
  );
}
