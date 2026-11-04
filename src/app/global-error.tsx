'use client';

import { Norican, Overlock } from 'next/font/google';
import PageStateError from '@/components/PageStateError';
import './globals.css';

/**
 * OOP-6737 — the global error boundary.
 *
 * WHY THIS FILE EXISTS
 *
 * Next does not let a segment's `error.tsx` catch an error thrown in that
 * segment's own `layout.tsx`. A throw in the root layout therefore
 * escapes every boundary in the tree, and Next renders its own fallback
 * document: *"Application error: a server-side exception has occurred"* —
 * no branding, no styles, no language, and a stack trace in development.
 *
 * `global-error.tsx` is the boundary for exactly that case. It replaces the
 * root layout, so it must bring its own document.
 *
 * WHERE IT GOES, AND WHY
 *
 * The root layout of this app is `src/app/[locale]/layout.tsx` (OOP-6710)
 * — there is no `src/app/layout.tsx`. Next documents this shape: a
 * `global-error.js` in the ROOT app directory handles errors in the root
 * layout "even when leveraging internationalization". So the file sits at
 * `src/app/global-error.tsx`, beside `global-not-found.tsx`, which owns the
 * 404 document for the same reason (OOP-6762).
 *
 * MEASURED, not assumed: Next resolves the custom global error at the
 * ROOT LAYER (`segments.length === 0` in its app loader), which is the
 * app root — so a `global-error.tsx` inside `src/app/[locale]/` is
 * silently ignored and the built-in error page is used instead. The
 * boundary also renders on the CLIENT: the server sends Next's
 * `__next_error__` shell with the boundary in the flight payload, so the
 * page only shows the branded card once React has hydrated it. A `curl`
 * cannot see the result — it has to be a browser.
 *
 * WHAT THIS DOCUMENT HAS TO BRING ITSELF
 *
 * It replaces the layout, so it has to import the styles and the fonts
 * the card needs — the same ones `src/app/[locale]/layout.tsx` loads — or
 * the card renders unstyled.
 *
 * WHY THE COPY IS IN HERE AND NOT IN THE CATALOGUE
 *
 * `useTranslations` needs a `NextIntlClientProvider` above it, and this
 * boundary has none: it replaced the layout that provided one. It must
 * also not depend on the catalogue loading, because the failure it
 * catches may BE the catalogue failing to load — a global error page that
 * can fail the same way as the thing it is there for is no error page at
 * all. So the copy is inline, in the site's default language, and the
 * `lang` attribute says so.
 *
 * The card itself is the shared one (`PageStateError`), so a global
 * failure reads like every other failure on the site: the same icon, the
 * same retry button, the same digest.
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
 * The copy. Kept in step with `Common.error` in `src/messages/en.json` —
 * `src/app/global-error.test.ts` asserts it.
 */
const COPY = {
  title: 'Something went wrong',
  body: 'That page hit an unexpected error. Try again — if it keeps failing, head back home.',
  retry: 'Try again',
};

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html
      lang="en"
      className={`${norican.variable} ${overlock.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <main className="lb-landing-page">
          <PageStateError error={error} reset={reset} icon="⚠️" copy={COPY} />
        </main>
      </body>
    </html>
  );
}
