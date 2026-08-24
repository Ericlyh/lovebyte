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
 * action. After the cookie is set we router.refresh() so server components
 * re-render in the new locale on the same URL (localePrefix: 'never').
 */
export function LanguageToggle() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(target: Locale) {
    if (target === locale || isPending) return;
    startTransition(async () => {
      await setLocale(target);
      router.refresh();
    });
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
