import { NextResponse, type NextRequest } from 'next/server';
import { routing, type Locale } from '@/lib/i18n/routing';

/**
 * LoveByte proxy — locale resolution only (no URL rewrite).
 *
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`. Functionality is the
 * same: runs on the edge before routes render, can set headers / cookies
 * / redirect. We use it ONLY to populate the locale that next-intl's
 * `getRequestConfig` reads via the `X-NEXT-INTL-LOCALE` header (see
 * node_modules/next-intl/dist/esm/development/server/react-server/
 * RequestLocale.js).
 *
 * We deliberately do NOT use `createMiddleware` from next-intl here.
 * With `localePrefix: 'never'`, that middleware still does an internal
 * URL rewrite to `/[locale]/...` so it can read the locale off the URL —
 * but LoveByte has no `/[locale]/...` routes (architecture §5: recipient
 * links must work without a prefix). Doing the locale resolution in this
 * proxy avoids the rewrite while preserving the architecture.
 *
 * Resolution order (see architecture §5):
 *   1. `lb-locale` cookie (the user's chosen language)
 *   2. `Accept-Language` header (the recipient's browser language)
 *   3. Fall back to `defaultLocale` ('en')
 */
export function proxy(request: NextRequest) {
  const locale = resolveLocale(request);

  // Forward the resolved locale to the request so getRequestConfig
  // (`src/lib/i18n/request.ts`) sees it via headers().get(...).
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('X-NEXT-INTL-LOCALE', locale);

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });

  // Persist the resolved locale as a cookie so the next request can
  // skip the Accept-Language round-trip.
  if (request.cookies.get('lb-locale')?.value !== locale) {
    response.cookies.set('lb-locale', locale, {
      maxAge: 60 * 60 * 24 * 365, // 1 year, matches routing.ts
      sameSite: 'lax',
      path: '/',
    });
  }

  return response;
}

export const config = {
  // Same matcher as the scaffold's original middleware — every page
  // except API routes, Next internals, Vercel internals, and dot assets.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

function resolveLocale(request: NextRequest): Locale {
  // 1. Cookie wins if set and supported.
  const cookieLocale = request.cookies.get('lb-locale')?.value;
  if (cookieLocale && isSupportedLocale(cookieLocale)) {
    return cookieLocale;
  }

  // 2. Accept-Language: parse for best match.
  const accept = request.headers.get('Accept-Language') ?? '';
  const preferred = accept
    .split(',')
    .map((entry) => {
      const [tag, ...params] = entry.trim().split(';');
      const qParam = params.find((p) => p.startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return { tag: tag.toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of preferred) {
    if (isSupportedLocale(tag)) return tag;
    // Match "zh-tw" / "zh-hk" etc. to "zh-Hant".
    if (tag.startsWith('zh')) return 'zh-Hant';
  }

  // 3. Default.
  return routing.defaultLocale;
}

function isSupportedLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
