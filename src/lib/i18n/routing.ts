import { defineRouting } from 'next-intl/routing';

/**
 * LoveByte routing config.
 *
 * Locale-prefix strategy: `never` — URLs never carry a locale prefix, so
 * the recipient experience at /g/[token] is identical regardless of which
 * language the sender composed in. The locale is resolved from a cookie
 * (set on signup / language toggle) or Accept-Language as a fallback.
 *
 * See design/04-architecture/architecture.md §5 for the i18n rationale.
 */
export const routing = defineRouting({
  locales: ['en', 'zh-Hant'],
  defaultLocale: 'en',
  localePrefix: 'never',
  localeCookie: {
    name: 'lb-locale',
    // 1 year — the user's preferred language persists across sessions.
    maxAge: 60 * 60 * 24 * 365,
  },
});

export type Locale = (typeof routing.locales)[number];
