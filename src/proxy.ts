import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { routing, type Locale } from '@/lib/i18n/routing';

/**
 * LoveByte proxy — locale resolution + Supabase auth cookie refresh.
 *
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`. Functionality is the
 * same: runs on the edge before routes render, can set headers / cookies
 * / redirect.
 *
 * Two responsibilities:
 *
 *   1. Resolve the UI locale (cookie → Accept-Language → default) and
 *      forward it as `X-NEXT-INTL-LOCALE` so `getRequestConfig` reads it
 *      (see node_modules/next-intl/dist/esm/development/server/react-server/
 *      RequestLocale.js). We deliberately do NOT use `createMiddleware`
 *      from next-intl — with `localePrefix: 'never'` it still rewrites
 *      to `/[locale]/...`, but LoveByte has no `/[locale]/...` routes
 *      (architecture §5: recipient links must work without a prefix).
 *
 *   2. Refresh Supabase auth cookies. @supabase/ssr's `createServerClient`
 *      requires a Server Action or middleware boundary to actually
 *      persist refreshed tokens back to the cookie store. Calling
 *      `supabase.auth.getUser()` here forces the library to read the
 *      current session, refresh if needed, and write any new tokens via
 *      the `setAll` callback. Without this, a sign-in followed by an
 *      immediate redirect could land on `/` before the auth cookie is
 *      written — and the next server render would see `auth.getUser()`
 *      return null. This is the M-B cookie round-trip risk from OOP-4284.
 *
 * Cookie round-trip (verified manually on Vercel, see OOP-4284 delivery):
 *   - signUp / signIn write tokens via `cookies().set()` in the server
 *     action's setAll callback.
 *   - This proxy then runs on the redirect target. `getUser()` forces a
 *     refresh if the access token is about to expire, persisting any
 *     rotated tokens back through `response.cookies.set(...)`.
 *   - Subsequent requests land on a valid session, RLS sees the user,
 *     and `/u/[handle]` + onboarding reads work without an extra
 *     full-page reload.
 */
export async function proxy(request: NextRequest) {
  const locale = resolveLocale(request);

  // Build a mutable response we can attach both forwarded headers AND
  // Supabase-refreshed cookies to.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('X-NEXT-INTL-LOCALE', locale);

  const response = NextResponse.next({
    request: { headers: forwardedHeaders },
  });

  // Persist the resolved locale as a cookie if it changed.
  if (request.cookies.get('lb-locale')?.value !== locale) {
    response.cookies.set('lb-locale', locale, {
      maxAge: 60 * 60 * 24 * 365, // 1 year, matches routing.ts
      sameSite: 'lax',
      path: '/',
    });
  }

  // Refresh Supabase auth cookies. createServerClient reads from the
  // incoming cookies and writes any rotated tokens into `response`.
  // We do NOT call `supabase.auth.getUser()` here in the proxy — that
  // hits PostgREST on every request. Instead we call `getSession()`,
  // which only inspects the JWT (no DB roundtrip) and triggers the
  // refresh path when the access token is within ~60s of expiry. If
  // there is no session at all, this is a no-op and we skip the DB hit.
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      },
    );

    // getSession() reads the JWT, validates locally, refreshes if
    // needed. Returns null when there's no session — we still want
    // the call to complete so any refresh path runs.
    await supabase.auth.getSession();
  } catch (err) {
    // Never let a Supabase client construction failure break the
    // proxy. Log and fall through — the user will get bounced to
    // /login by the page-level getUser() check anyway.
    console.error('[proxy] supabase refresh failed', err);
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