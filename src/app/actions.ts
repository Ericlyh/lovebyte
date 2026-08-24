'use server';

import { cookies } from 'next/headers';
import { type Locale } from '@/lib/i18n/routing';

/**
 * Cookie name + TTL — must match src/lib/i18n/routing.ts `localeCookie`.
 * Hardcoded here because `routing.localeCookie` is typed as a union and
 * Next's `cookies().set()` wants a plain `CookieAttributes` shape.
 */
const LOCALE_COOKIE = {
  name: 'lb-locale',
  maxAge: 60 * 60 * 24 * 365, // 1 year
} as const;

/**
 * Set the user's preferred UI locale.
 *
 * Persists as the `lb-locale` cookie. Next-intl middleware reads it on
 * every request — so `/g/[token]` resolves the right message bundle for
 * whichever language the recipient toggles to. Calling page should follow
 * with `router.refresh()` to re-render server components in the new locale.
 */
export async function setLocale(locale: Locale) {
  const store = await cookies();
  store.set(LOCALE_COOKIE.name, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE.maxAge,
    sameSite: 'lax',
  });
}
