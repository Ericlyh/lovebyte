import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

/**
 * The proxy's response contract (OOP-6721).
 *
 * The bug these lock down: the proxy used to WRITE `Set-Cookie: lb-locale`
 * on every first request. A `Set-Cookie` makes a response private to the
 * visitor by definition, so no `s-maxage` a sibling issue adds can ever
 * produce a cache hit — and a cached entry carrying somebody else's
 * `Set-Cookie` would pin every later visitor to that person's locale.
 *
 * The replacement is to declare the variance (`Vary`) instead of writing
 * the cookie, and to keep READING the cookie so an explicit user toggle
 * still wins.
 */

const ORIGIN = 'https://lovorithm.test';

/** Next's own RequestInit — the DOM one has a `signal` Next does not accept. */
type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function request(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(new URL(path, ORIGIN), init);
}

/** The cookie names a response sets, in order. */
function setCookieNames(response: Response): string[] {
  return response.headers
    .getSetCookie()
    .map((header) => header.split('=', 1)[0].trim());
}

/** The internal path the proxy rewrote to — this is the locale it picked. */
function rewriteTarget(response: Response): string {
  const target = response.headers.get('x-middleware-rewrite');
  expect(target).toBeTruthy();
  return new URL(target!).pathname;
}

/** The locale the proxy forwarded to the route. */
function forwardedLocale(response: Response): string | null {
  return response.headers.get('x-middleware-request-x-next-intl-locale');
}

beforeAll(() => {
  // The proxy builds a Supabase client to refresh auth cookies. Point it
  // at a URL that resolves to nothing — with no auth cookie in the
  // request, `getSession()` returns null without a network call, so the
  // refresh path is exercised without touching the network.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
});

describe('proxy — the locale cookie is read, never written (OOP-6721)', () => {
  it('does not set the locale cookie on a first visit', async () => {
    const response = await proxy(request('/'));

    expect(setCookieNames(response)).not.toContain('lb-locale');
  });

  it('does not set the locale cookie when the visitor already has one', async () => {
    const response = await proxy(
      request('/', { headers: { cookie: 'lb-locale=zh-Hant' } }),
    );

    expect(setCookieNames(response)).not.toContain('lb-locale');
  });

  it('does not set the locale cookie when Accept-Language disagrees with it', async () => {
    // The old code wrote the cookie whenever the resolved locale differed
    // from the cookie on the request — so a visitor whose browser asks for
    // English got their Chinese cookie overwritten on every request.
    const response = await proxy(
      request('/', {
        headers: { cookie: 'lb-locale=zh-Hant', 'accept-language': 'en' },
      }),
    );

    expect(setCookieNames(response)).not.toContain('lb-locale');
    // The cookie still wins over Accept-Language.
    expect(rewriteTarget(response)).toBe('/zh-Hant');
  });

  it('declares the variance it actually has', async () => {
    const response = await proxy(request('/'));
    const vary = response.headers.get('vary') ?? '';

    expect(vary.toLowerCase()).toContain('cookie');
    expect(vary.toLowerCase()).toContain('accept-language');
  });

  it('still reads the cookie, so an explicit toggle wins', async () => {
    const response = await proxy(
      request('/', { headers: { cookie: 'lb-locale=zh-Hant' } }),
    );

    expect(rewriteTarget(response)).toBe('/zh-Hant');
    expect(forwardedLocale(response)).toBe('zh-Hant');
  });

  it('falls back to Accept-Language when there is no cookie', async () => {
    const response = await proxy(
      request('/', { headers: { 'accept-language': 'zh-Hant,zh;q=0.9' } }),
    );

    expect(rewriteTarget(response)).toBe('/zh-Hant');
    expect(forwardedLocale(response)).toBe('zh-Hant');
  });

  it('defaults to English when the visitor says nothing', async () => {
    const response = await proxy(request('/'));

    expect(rewriteTarget(response)).toBe('/en');
    expect(forwardedLocale(response)).toBe('en');
  });

  it('still mints the analytics session cookie (OOP-6716 is untouched)', async () => {
    const first = await proxy(request('/'));
    expect(setCookieNames(first)).toContain('lb-sid');

    const sessionId = first.headers
      .getSetCookie()
      .find((header) => header.startsWith('lb-sid='))!
      .split('=')[1]
      .split(';')[0];

    const second = await proxy(
      request('/', { headers: { cookie: `lb-sid=${sessionId}` } }),
    );
    expect(setCookieNames(second)).not.toContain('lb-sid');
  });

  it('forwards the auth cookies to the route (AC4 — the refresh path is intact)', async () => {
    const authCookie = 'sb-abc-auth-token=0.0.0.0%3A%3A; Path=/; HttpOnly';
    const response = await proxy(
      request('/', { headers: { cookie: authCookie } }),
    );

    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      'sb-abc-auth-token',
    );
  });
});

describe('the platform layer carries the same declaration (OOP-6721)', () => {
  /**
   * Next's app-router runtime owns the `Vary` header of a page response
   * (`res.setHeader('Vary', varyHeader)` in the app-page runtime), so the
   * proxy's declaration is overwritten before the response is sent. What
   * reaches the client is `vercel.json`'s — applied by the platform after
   * Next has finished. The two have to agree, or the client is told the
   * response does not vary when it does.
   */
  const vercel = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  );
  const varyHeader = (
    vercel.headers as { headers: { key: string; value: string }[] }[]
  )[0].headers.find((h) => h.key.toLowerCase() === 'vary')?.value ?? '';

  it('declares the cookie and language variance', () => {
    expect(varyHeader).toContain('Cookie');
    expect(varyHeader).toContain('Accept-Language');
  });

  it('keeps the values Next sets, in case the platform replaces the header', () => {
    // If Vercel's config REPLACES the header rather than appending, these
    // are the only thing keeping an RSC response and a document response
    // apart in the browser's cache.
    for (const header of [
      'rsc',
      'next-router-state-tree',
      'next-router-prefetch',
      'next-router-segment-prefetch',
    ]) {
      expect(varyHeader).toContain(header);
    }
  });
});
