import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { routing, type Locale } from '@/lib/i18n/routing';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  SESSION_HEADER,
  isSessionId,
  newSessionId,
} from '@/lib/analytics/session-id';

/**
 * Lovorithm proxy — locale resolution + Supabase auth cookie refresh.
 *
 * Next.js 16 renamed `middleware.ts` → `proxy.ts`. Functionality is the
 * same: runs on the edge before routes render, can set headers / cookies
 * / redirect.
 *
 * Two responsibilities:
 *
 *   1. Resolve the UI locale (cookie → Accept-Language → default), rewrite
 *      the request to the internal `/{locale}/…` path, and forward the
 *      locale as `X-NEXT-INTL-LOCALE` so `getRequestConfig` reads it
 *      (see node_modules/next-intl/dist/esm/development/server/react-server/
 *      RequestLocale.js). We deliberately do NOT use `createMiddleware`
 *      from next-intl — we need the Supabase refresh below in the same
 *      edge function, and next-intl's middleware would own the rewrite.
 *      The rewrite is internal only: the public URL keeps the locale-less
 *      form (architecture §5 — recipient links must work without a
 *      prefix), while the app tree underneath is `src/app/[locale]/…` so
 *      that every page can be prerendered once per locale (OOP-6710).
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

  // OOP-6716 — the anonymous analytics session id.
  //
  // Every recorded event carries one, so the funnel can be read as "how
  // many PEOPLE reached step N" rather than "how many clicks happened".
  // It is a random uuid: no account, no IP, no device — a correlation
  // handle and nothing more.
  //
  // The id is set as an httpOnly cookie so page scripts cannot read it,
  // and it is ALSO forwarded as a request header. The header exists for
  // the first request of a session: the cookie is set on the RESPONSE,
  // so the request that renders the page does not carry it yet — and
  // without the header the first server-side event of a session would
  // be filed under a throwaway id and would not join the visitor's
  // other steps.
  //
  // The header is overwritten on every request, so a client cannot
  // forge it.
  const cookieSession = request.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = isSessionId(cookieSession);
  const sessionId = hasSession ? cookieSession : newSessionId();

  // Build a mutable response we can attach both forwarded headers AND
  // Supabase-refreshed cookies to.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('X-NEXT-INTL-LOCALE', locale);
  forwardedHeaders.set(SESSION_HEADER, sessionId);

  // OOP-6710 — rewrite the public URL to the internal `/{locale}/…` form.
  //
  // The app tree lives under `src/app/[locale]/`, so every page is
  // prerendered once per locale at build time. The browser still asks for
  // `/` (localePrefix: 'never' — recipient gift links must never carry a
  // locale prefix); this rewrite is internal, so the address bar and every
  // link on the site keep the locale-less form. What the rewrite buys us is
  // that the edge picks the prerendered variant from the `lb-locale`
  // cookie, which is the only place the locale lives.
  //
  // The alternative — serving one page and letting the client swap the
  // language — would mean shipping every locale's copy to every visitor
  // and rendering the wrong one first. This way each visitor downloads
  // exactly one locale's HTML.
  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  // A locale-prefixed URL is not part of the public URL space. Redirect it
  // back to the locale-less form so there is exactly one canonical URL per
  // page (and so `/en` doesn't render a second copy of the landing page).
  const firstSegment = pathname.split('/')[1] ?? '';
  if (isSupportedLocale(firstSegment)) {
    const stripped = pathname.slice(firstSegment.length + 1) || '/';
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = stripped;
    return NextResponse.redirect(redirectUrl);
  }

  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;

  const response = NextResponse.rewrite(url, {
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

  // OOP-6716 — mint the analytics session cookie on the visitor's first
  // page request. `httpOnly` so no page script can read it; the
  // browser-side reporter never handles the session id at all.
  if (!hasSession) {
    response.cookies.set(SESSION_COOKIE, sessionId, {
      maxAge: SESSION_COOKIE_MAX_AGE, // 1 year, matches routing.ts
      sameSite: 'lax',
      httpOnly: true,
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
  //
  // OOP-5048: prefer the publishable key (sb_publishable_…) so the
  // proxy keeps working after OOP-4894 disabled the legacy anon JWT
  // at the Supabase gateway. See `lovebyte-supabase-disable-legacy-jwt`.
  try {
    const supabaseKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseKey) throw new Error('missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or ANON_KEY)');
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseKey,
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