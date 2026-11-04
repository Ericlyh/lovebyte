/**
 * The shared-cache policy for HTML routes (OOP-6757).
 *
 * A shared cache stores one response and replays it to every visitor whose
 * request resolves to the same cache key. That is safe only when the
 * response does not depend on the requester. This module is where that
 * rule is decided; `scripts/check-cache-policy.mjs` enforces it against
 * the app tree, and the readiness gate checks it against production.
 *
 * ── The two kinds of page ─────────────────────────────────────────────
 *
 * A page is rendered one of two ways, and the difference is the whole
 * policy:
 *
 *   PRERENDERED (static, and ISR — the landing page's
 *   `export const revalidate = 300`): the HTML is produced by a render
 *   that is NOT a visitor's request. The revalidation render happens in
 *   the background, minutes apart from any request, so the stored copy
 *   carries no `Set-Cookie` and no visitor state. The edge may store it
 *   and replay it to everyone — that is the point of a prerender.
 *
 *   PER-REQUEST (dynamic — any page that reads the auth cookie, the
 *   request headers or the search params): the HTML is produced FOR one
 *   visitor, and the response carries that visitor's cookies. Next serves
 *   such a route `private, no-cache, no-store, max-age=0,
 *   must-revalidate`, so it never enters a shared cache. Next also
 *   refuses to build a route that mixes the two: a route with
 *   `revalidate` that reads cookies is a build error, not a runtime
 *   surprise.
 *
 * ── The analytics session cookie ──────────────────────────────────────
 *
 * `lb-sid` is the correlation handle that lets a funnel be read as "how
 * many PEOPLE reached step N" (OOP-6716). The proxy mints it on the
 * visitor's first page request and writes it on that response.
 *
 * For a per-request route that is exactly right: the response is private
 * to that visitor and is never stored.
 *
 * For a prerendered route the stored copy is the ARTIFACT — rendered
 * without a visitor request — so it carries no session id, and the
 * `Set-Cookie` the proxy adds is applied per request, to that visitor
 * alone. Measured on production 2026-11-04: three consecutive requests
 * to the same `HIT` entry received three DIFFERENT session ids, and a
 * request that already carried a cookie received no `Set-Cookie` at all
 * — which is the proof that the stored entry holds none.
 *
 * ── A signed-in request ───────────────────────────────────────────────
 *
 * A signed-in visitor gets the SAME shared entry as an anonymous one,
 * and the same bytes: the shared copy is the prerendered artifact, and
 * the auth state is resolved on the client (`<Nav deferAuth />`), so
 * nothing private is in it. The live probe checks that identity — the
 * etag and the body — on every gate run.
 *
 * An earlier version of this policy also marked a signed-in RESPONSE
 * `private, no-store` in the proxy. That was wrong, and the probe is
 * what showed it: the header cannot keep a response out of the cache
 * (the platform serves the entry anyway), and the middleware's response
 * headers are what the edge STORES, so the entry picked up
 * `private, no-store` and every later visitor got it. The rule is
 * therefore not "mark the response" but "keep the artifact free of
 * requester state" — which is a property of the page, not of a header.
 *
 * ── The rule ──────────────────────────────────────────────────────────
 *
 * A per-request route must never be given an explicit shared-cache
 * directive. An `s-maxage` header or an `export const revalidate` on such
 * a route would make the platform store a response that carries one
 * visitor's HTML AND their `Set-Cookie`, and replay both to the next
 * visitor: the wrong gift on the page, and every visitor's funnel events
 * merged into one session.
 *
 * The routes that DO carry an explicit directive are listed below. A route
 * that is not on the list must not have one, and `pnpm test` fails if it
 * does.
 */

/**
 * The page routes the edge caches with an explicit shared-cache directive.
 *
 * `/` — the landing page, which is prerendered once per locale and
 * re-rendered every five minutes (`export const revalidate = 300`) so a
 * listing that appears or changes price shows up within that window. It
 * is prerendered, so the stored copy carries no visitor state.
 *
 * To add a route here:
 *
 *   1. make sure it is PRERENDERED — if it reads the request, it is not
 *      eligible, and the edge must not store it;
 *   2. give it the directive (an `s-maxage` header, or `export const
 *      revalidate`) for that route alone;
 *   3. run `pnpm test` — `scripts/check-cache-policy.mjs` checks that the
 *      app tree and this list agree, in both directions.
 */
export const SHARED_CACHEABLE_PAGE_ROUTES: readonly string[] = ['/'];

/**
 * The public path of a request, normalised: a leading slash, no trailing
 * slash, and `/` for the root. The proxy sees the public path (the locale
 * prefix is added by the rewrite, after this), so this is the shape the
 * list is written in.
 */
export function normalisePath(pathname: string): string {
  const trimmed = pathname.split('?')[0].split('#')[0];
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

/**
 * True when the request path is a route the edge caches with an explicit
 * directive.
 *
 * `routes` is a parameter so a test can exercise a list other than the
 * policy's own without changing the policy for the whole app.
 */
export function isSharedCacheableRoute(
  pathname: string,
  routes: readonly string[] = SHARED_CACHEABLE_PAGE_ROUTES,
): boolean {
  const path = normalisePath(pathname);
  return routes.some((route) => normalisePath(route) === path);
}
