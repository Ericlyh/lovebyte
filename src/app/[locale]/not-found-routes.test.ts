import { describe, expect, it, vi } from 'vitest';

// The page modules transitively import the anon Supabase helper, which
// validates its env at IMPORT time. These values are never used — every
// read in this test is mocked — but the import has to succeed.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'sb_publishable_test';
process.env.SUPABASE_SECRET_KEY ??= 'sb_secret_test';

/**
 * The three routes that must answer a missing resource with a REAL
 * HTTP 404 (OOP-6729): /l/[giftId], /checkout/[giftId] and /g/[token].
 *
 * A missing listing used to be served as a "Gift not found" page with
 * HTTP 200 — an infinite, indexable URL space of soft-404s on gift
 * UUIDs. Three things have to hold for a route to answer 404, and this
 * test pins all three:
 *
 *   1. `generateMetadata` throws `notFound()` when the resource is
 *      missing, so the metadata never describes a page that does not
 *      exist;
 *   2. the page itself throws `notFound()`;
 *   3. the route carries NO segment-level `loading.tsx` — that file is
 *      a `<Suspense>` boundary AROUND the page, and a Suspense boundary
 *      lets Next.js flush the response shell (HTTP 200) before the
 *      page's `notFound()` can run, which is what turned every one of
 *      these 404s into a 200.
 *
 * The end-to-end status codes are asserted by
 * `scripts/notfound-status-e2e.mjs`; this file is the fast, hermetic
 * half that runs in `pnpm test`.
 */

vi.mock('@/lib/catalog', () => ({
  getListingDetail: vi.fn(async () => null),
  getListingComments: vi.fn(async () => ({ comments: [], nextCursor: null, totalCount: 0 })),
  getListingReplies: vi.fn(async () => ({ replies: [], nextCursor: null, totalCount: 0 })),
}));

vi.mock('@/lib/gifts/fetch', () => ({
  getEnvelopeByToken: vi.fn(async () => null),
}));

vi.mock('@/lib/checkout/gift', () => ({
  getCheckoutGift: vi.fn(async () => null),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    }),
  })),
}));

/**
 * Next's `notFound()` throws an error carrying this digest — the same
 * one Next itself uses to decide the response status.
 */
const NOT_FOUND_DIGEST = 'NEXT_HTTP_ERROR_FALLBACK;404';

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    String((error as { digest?: unknown }).digest).includes('404')
  );
}

async function expectNotFound(fn: () => Promise<unknown>) {
  let thrown: unknown;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected the route to throw notFound()').toBeDefined();
  expect(isNotFound(thrown), `expected a 404 digest, got ${String(thrown)}`).toBe(
    true,
  );
}

const MISSING_LISTING = {
  params: Promise.resolve({ locale: 'en', giftId: '00000000-0000-0000-0000-000000000000' }),
};
const MISSING_TOKEN = {
  params: Promise.resolve({ locale: 'en', token: 'zzzzzzzz' }),
};

describe('soft-404 routes answer a missing resource with 404 (OOP-6729)', () => {
  it('/l/[giftId] — generateMetadata throws notFound()', async () => {
    const { generateMetadata } = await import('./l/[giftId]/page');
    await expectNotFound(() => generateMetadata(MISSING_LISTING));
  });

  it('/checkout/[giftId] — generateMetadata throws notFound()', async () => {
    const { generateMetadata } = await import('./checkout/[giftId]/page');
    await expectNotFound(() => generateMetadata(MISSING_LISTING));
  });

  it('/g/[token] — generateMetadata throws notFound()', async () => {
    const { generateMetadata } = await import('./g/[token]/page');
    await expectNotFound(() => generateMetadata(MISSING_TOKEN));
  });

  it('/u/[handle] — unchanged: a missing creator is still a 404', async () => {
    // The control route. It has never had a loading.tsx, and it is the
    // behaviour the three routes above are being brought in line with.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.join(process.cwd(), 'src/app/[locale]/u/[handle]');
    const files = await fs.readdir(dir);
    expect(files).not.toContain('loading.tsx');
  });
});

describe('no route behind a loading.tsx can answer a 404 (OOP-6729)', () => {
  it.each([
    ['l/[giftId]', 'src/app/[locale]/l/[giftId]'],
    ['checkout/[giftId]', 'src/app/[locale]/checkout/[giftId]'],
    ['g/[token]', 'src/app/[locale]/g/[token]'],
  ])('%s has no segment-level loading.tsx', async (_name, rel) => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const dir = path.join(process.cwd(), rel);
    const files = await fs.readdir(dir);
    expect(
      files,
      `${rel}/loading.tsx is a <Suspense> boundary around the page: it flushes ` +
        `the response shell with HTTP 200 before the page's notFound() can run, ` +
        `so the route cannot answer a real 404.`,
    ).not.toContain('loading.tsx');
  });
});
