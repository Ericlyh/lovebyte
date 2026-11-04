# The shared-cache policy

**Status:** decided, 2026-11-04 (OOP-6757).
**Code:** `src/lib/cache-policy.ts` (the decision), `scripts/check-cache-policy.mjs`
(the static gate and the live probe), `src/proxy.ts` (the analytics cookie, and
the rule that keeps it off the stored copy).

## The question

OOP-6757 asked for a decision on two things, before any HTML route is given a
shared-cache directive:

> (a) an authenticated visitor must never be served a shared-cached page;
> (b) the analytics session id must not be baked into a cacheable entry.

Both are now answered, enforced in code, and measured against production.

## The decision

### 1. A page is either prerendered or per-request, and that decides everything

Next.js renders a page one of two ways, and the difference IS the policy.

**Prerendered** (static, and ISR — the landing page's
`export const revalidate = 300`): the HTML is produced by a render that is
not a visitor's request. The ISR re-render happens in the background,
minutes apart from any request. **The stored copy therefore carries no
`Set-Cookie` and no visitor state**, and the edge may store it and replay it
to everyone. That is what a prerender is for.

**Per-request** (dynamic — any page that reads the auth cookie, the request
headers or the search params): the HTML is produced *for* one visitor, and
the response carries that visitor's cookies. Next serves such a route
`private, no-cache, no-store, max-age=0, must-revalidate`, so it never enters
a shared cache.

A route that mixes the two — `export const revalidate` **and** a read of
`cookies()` — is **not** a build error. Measured on Next 16.3.2, 2026-11-04:
the build succeeds, prints nothing about the mix, and the route is quietly
downgraded to per-request rendering (it appears as `ƒ (Dynamic)` in the route
table). So mixing is *safe* — a downgraded route is served
`private, no-cache, no-store` and never enters a shared cache — but it is
*silent*: nothing warns you, and the route simply stops being a shared-cache
candidate. The static gate is what surfaces that at review time.

### 2. The analytics session cookie is written on every page response, and that is safe

`lb-sid` is the correlation handle that lets a funnel be read as "how many
PEOPLE reached step N" (OOP-6716). The proxy mints it on the visitor's first
page request and writes it on that response.

- On a **per-request** route the response is private to that visitor and is
  never stored, so the cookie travels with it and with nobody else.
- On a **prerendered** route the cached copy is the artifact — rendered
  without a visitor request — so it carries no session id, and the
  `Set-Cookie` the proxy adds is applied to that one visitor.

Measured on production, 2026-11-04: three consecutive requests to the same
`HIT` entry received three **different** session ids, and a request that
already carried a cookie received **no** `Set-Cookie` at all — which is the
proof that the stored entry holds none.

### 3. A signed-in requester gets exactly what an anonymous one gets

A signed-in visitor is served the **same shared entry** as an anonymous
one, and the same bytes: the shared copy is the prerendered artifact, and
the auth state is resolved on the client (`<Nav deferAuth />`), so nothing
private is in it. The live probe checks that identity — the `etag` and the
body — on every gate run.

**An earlier version of this policy also marked a signed-in response
`private, no-store` in the proxy. It was wrong, and the probe is what
showed it.** Two reasons, both measured:

- the header cannot keep a response out of the cache — the platform
  answers the signed-in request from the shared entry anyway;
- worse, the middleware's response headers are what the edge **stores**,
  so the entry picked up `private, no-store` and every later visitor got
  it — and, with a `CDN-Cache-Control` in the entry, the platform stopped
  normalising the client-facing `Cache-Control` for everyone.

The rule is therefore not "mark the response" but "**keep the artifact
free of requester state**" — a property of the page, not of a header.

The pages whose HTML *does* depend on the requester are per-request routes
(`/settings`, `/purchases`, `/checkout/*`, `/create/*`, `/u/me`), and
those are served `private, no-cache, no-store` by Next and never enter a
shared cache. The probe asserts that too.

### 4. The rule that keeps the two apart

> An explicit shared-cache directive (an `s-maxage` header, or `export const
> revalidate`, which Next serves as `s-maxage=<revalidate>`) may appear only
> on a route listed in `SHARED_CACHEABLE_PAGE_ROUTES`, and **never** on a
> per-request route.

The list is `['/']` — the landing page, which is prerendered and re-rendered
every five minutes so a new listing or a price change shows up within that
window.

An `s-maxage` on a per-request route would make the platform store a
response that carries one visitor's HTML *and* their `Set-Cookie`, and replay
both to the next visitor: the wrong gift on the page, and every visitor's
funnel events merged into a single session.

## How it is enforced

| | What it checks | Where it runs |
|---|---|---|
| **The static gate** | every shared-cache directive is on a listed route, and none is on a per-request route; a listed route that no longer exists | `pnpm test` → `src/lib/cache-policy.test.ts` → `scripts/check-cache-policy.mjs` |
| **The live probe** | one shared entry for every visitor; two visitors get two session ids; a visitor with a cookie gets no `Set-Cookie`; a signed-in requester gets the same entry and the same body as an anonymous one; a per-request route is `private, no-store` and is not a shared entry | the readiness gate (`scripts/readiness-gate.mjs`, daily at 02:20 HKT) and by hand: `node scripts/check-cache-policy.mjs --live` |

The static half fails the build; the live half fails the daily gate and
files a gap with a stable id (`cache-<check>-broken`), so the loop matches it
against an open issue instead of filing a duplicate every day.

## Adding a route to the list

1. Make sure the route is **prerendered**. If it reads the request, it is not
   eligible — the edge must not store it.
2. Give it the directive for that route alone (`export const revalidate` in
   the page, or an `s-maxage` header whose `source` is exactly that path — a
   pattern that covers more than one path is refused by the gate).
3. Run `pnpm test`. The static gate checks the app tree and the list in both
   directions, so a route that is listed but not cached, or cached but not
   listed, fails the build.

## What is deliberately NOT done

- **No `Vary: Cookie` on the page responses.** Next owns the `Vary` header
  of a page response and overwrites it with its own list, so a `Vary` set
  here never reaches the client; and Vercel keys its cache on the REWRITTEN
  path, so the locale variants are already separate entries (`/en` vs
  `/zh-Hant`). The locale cookie is read, never written (OOP-6721).
- **No per-route `private` marking of public pages.** A prerendered page's
  body is byte-identical for every visitor (auth is resolved on the client by
  `<Nav deferAuth />`), so sharing it leaks nothing — and forcing those
  requests to the origin would slow the pages that convert.
- **The analytics cookie is not moved off the page response.** It would break
  the landing-page view event: `/api/track` refuses a request that carries no
  session cookie, on purpose — an analytics sink that invents its own
  sessions is a sink anyone can spam.
