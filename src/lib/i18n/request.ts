import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import en from '../../messages/en.json';
import zhHant from '../../messages/zh-Hant.json';

/**
 * Static map of message bundles — required by Turbopack (Next.js 16's
 * default bundler), which cannot resolve a runtime-templated
 * `import('../../messages/${locale}.json')`. Static imports keep the
 * build deterministic and let the bundler tree-shake unused locales.
 */
const messages = {
  en,
  'zh-Hant': zhHant,
} as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    messages: messages[locale],
  };
});
