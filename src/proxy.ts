import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from '@/lib/i18n/routing';

/**
 * Next.js 16 Proxy (formerly Middleware).
 *
 * In v16 the middleware file convention was renamed to `proxy.ts` and
 * exports a function called `proxy`. Functionality is unchanged — it
 * still runs on the edge before routes are rendered and can redirect,
 * rewrite, set headers, etc. See:
 *   node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
 *
 * For LoveByte this proxy's only job is i18n locale resolution —
 * setting the lb-locale cookie and the x-next-intl-locale header
 * that next-intl's getRequestConfig reads in src/lib/i18n/request.ts.
 */
const intlMiddleware = createMiddleware(routing);

export function proxy(request: NextRequest) {
  return intlMiddleware(request);
}

export const config = {
  // Run on every path except: API routes, Next internals, Vercel internals,
  // and paths that contain a dot (assets like .css, .js, .png, .ico).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
