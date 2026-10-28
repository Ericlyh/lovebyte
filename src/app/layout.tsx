import type { Metadata } from 'next';
import { Norican, Overlock } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { OfflineBanner } from '@/components/OfflineBanner';
import { BRAND } from '@/lib/brand';
import './globals.css';

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

const DESCRIPTION = `${BRAND.NAME} turns your photos, voice notes, and words into a one-of-a-kind digital gift — a memory card game, a love letter, a quiz only they would know how to pass.`;

// OOP-6155 — the social card image. Static asset rendered from the brand
// tokens by `scripts/generate-og-image.mjs`; absolute URL so crawlers can
// fetch it from the canonical host.
const OG_IMAGE = {
  url: `${BRAND.PRODUCTION_URL}/og.png`,
  width: 1200,
  height: 630,
  alt: `${BRAND.NAME} — ${BRAND.TAGLINE}`,
};

export const metadata: Metadata = {
  // Every relative URL in metadata (the /api/og/<token> social card, the
  // sitemap pointer) resolves against this base. Without it Next resolves
  // them against the incoming request host, which on an aliased or
  // preview deployment is not the canonical domain — a shared gift link
  // would unfurl with a preview-host image URL.
  metadataBase: new URL(BRAND.PRODUCTION_URL),
  title: `${BRAND.NAME} — ${BRAND.TAGLINE}`,
  description: DESCRIPTION,
  // OOP-5816 — social share previews. The launch checklist expects
  // og:/twitter: tags on the landing page; without them a shared link
  // unfurls with no title, no description, no card.
  openGraph: {
    type: 'website',
    siteName: BRAND.NAME,
    title: `${BRAND.NAME} — ${BRAND.TAGLINE}`,
    description: DESCRIPTION,
    url: BRAND.PRODUCTION_URL,
    locale: 'en_GB',
    images: [OG_IMAGE],
  },
  twitter: {
    // `summary_large_image` (not `summary`) so the 1200x630 card renders
    // full-width rather than as a small thumbnail.
    card: 'summary_large_image',
    title: `${BRAND.NAME} — ${BRAND.TAGLINE}`,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
  },
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${norican.variable} ${overlock.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/*
            Phase 9 (OOP-4225) — typed offline indicator. Renders
            nothing when navigator.onLine is true; appears at the
            top of every page when the user loses connectivity so
            form submissions don't silently hang.
          */}
          <OfflineBanner />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
