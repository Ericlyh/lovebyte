import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { pickScopes } from './scopes';

/**
 * OOP-6726 — the message provider, cut down to what one route needs.
 *
 * `NextIntlClientProvider` serialises its `messages` prop into the RSC
 * payload, which is what ships to the browser. Handing it the whole
 * bilingual bundle therefore put all ~50 KB of it on every page — the
 * landing page included, which uses about 3 KB of it.
 *
 * This component cuts the bundle down to the requested scopes before
 * handing it over. Server components are unaffected: they resolve their
 * own translations through `getTranslations()`, which reads the request
 * config directly. Only the browser — where `useTranslations()` reads the
 * provider's context — sees the trimmed bundle.
 *
 * Nested providers do NOT merge (the nearest one wins), so a route's
 * provider has to carry every scope its own tree needs. `scopes.test.ts`
 * enforces that.
 *
 * `locale` is passed in rather than read from the request: the locale
 * comes from the route segment, and reading it from headers would opt the
 * route into dynamic rendering and cost us the prerender (OOP-6710).
 */
type Props = {
  locale: string;
  scopes: readonly string[];
  children: ReactNode;
};

export async function ScopedMessages({ locale, scopes, children }: Props) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={pickScopes(messages, scopes)}>
      {children}
    </NextIntlClientProvider>
  );
}
