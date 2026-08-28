'use client';

import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/app/actions';
import { type Locale } from '@/lib/i18n/routing';

const LABELS: Record<Locale, string> = {
  en: 'EN',
  'zh-Hant': '繁中',
};

const ARIA: Record<Locale, string> = {
  en: 'Switch to English',
  'zh-Hant': '切換到繁體中文',
};

/**
 * Bilingual toggle wired to the `lb-locale` cookie via the setLocale server
 * action.
 *
 * **Cookie-race fix (OOP-4284 follow-up, comment 339c9a62):** calling
 * `router.refresh()` immediately after `await setLocale(target)` can race
 * the browser's cookie store — the refresh request still carries the old
 * `lb-locale`, the proxy re-resolves the old locale, and the layout
 * re-renders unchanged. The user sees "clicked, nothing happened".
 *
 * Ladder (in priority order, runs inside `startTransition` so the button
 * stays disabled):
 *   1. `await setLocale(target)` — server action writes the cookie
 *   2. `router.refresh()` — cheap SPA-style re-render
 *   3. After 100 ms, read `document.cookie`. If it doesn't yet reflect
 *      the new locale, fall back to `window.location.reload()` which
 *      guarantees the proxy sees the new cookie before the next render.
 *
 * Vercel logs carry `[i18n/setLocale] leg=refresh|reload` so we can see
 * which leg fired in production.
 */
export function LanguageToggle() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(target: Locale) {
    if (target === locale || isPending) return;
    startTransition(async () => {
      try {
        await setLocale(target);
      } catch (err) {
        console.error('[i18n/setLocale] leg=setLocale-failed', err);
        return;
      }
      router.refresh();

      // Cookie-write race fallback. Read the cookie after a microtask +
      // a small wait; if it didn't flip, do a hard reload so the proxy
      // is forced to read the new cookie on the next request.
      await new Promise((r) => setTimeout(r, 100));
      const cookieNow = readLocaleCookie();
      if (cookieNow !== target) {
        console.warn(
          '[i18n/setLocale] leg=reload cookie-still-stale',
          { expected: target, got: cookieNow },
        );
        window.location.reload();
      } else {
        console.info('[i18n/setLocale] leg=refresh');
      }
    });
  }

  function readLocaleCookie(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)lb-locale=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  return (
    <div className="lb-lang-toggle" role="group" aria-label="Language">
      {(Object.keys(LABELS) as Locale[]).map((target) => (
        <button
          key={target}
          type="button"
          className={target === locale ? 'is-active' : ''}
          aria-pressed={target === locale}
          aria-label={ARIA[target]}
          onClick={() => switchTo(target)}
          disabled={isPending}
        >
          {LABELS[target]}
        </button>
      ))}
    </div>
  );
}
