import { describe, expect, it } from 'vitest';
import { findCachePolicyViolations } from '../../scripts/check-cache-policy.mjs';
import {
  SHARED_CACHEABLE_PAGE_ROUTES,
  isSharedCacheableRoute,
  normalisePath,
} from './cache-policy';

/**
 * The shared-cache policy (OOP-6757).
 *
 * The policy is one rule: a page route may carry an explicit shared-cache
 * directive only if it is listed in `SHARED_CACHEABLE_PAGE_ROUTES`, and
 * never if it is a per-request route — the edge must not store a response
 * that was rendered for one visitor, because that response carries that
 * visitor's HTML and their `Set-Cookie`.
 *
 * The rule is enforced by `scripts/check-cache-policy.mjs`, which is run
 * here so `pnpm test` fails when the app tree and the policy disagree.
 * The other half of the policy — that the deployed site really does serve
 * one shared entry with nobody's session id in it — is measured by the
 * live probe in the same script, which the readiness gate runs.
 */
describe('the shared-cache policy', () => {
  it('has no violation in the app tree', () => {
    const violations = findCachePolicyViolations({
      routes: SHARED_CACHEABLE_PAGE_ROUTES,
    });

    expect(
      violations.map((violation) => `${violation.file}: ${violation.message}`),
    ).toEqual([]);
  });
});

describe('isSharedCacheableRoute', () => {
  it('matches an exact path', () => {
    expect(isSharedCacheableRoute('/', ['/'])).toBe(true);
    expect(isSharedCacheableRoute('/browse', ['/browse'])).toBe(true);
  });

  it('does not match a different path', () => {
    expect(isSharedCacheableRoute('/gifts', ['/browse'])).toBe(false);
  });

  it('does not match a path that only shares a prefix', () => {
    // `/browse` must not cover `/browse/featured` — a sub-path is a
    // different route with different content.
    expect(isSharedCacheableRoute('/browse/featured', ['/browse'])).toBe(false);
  });

  it('is false for a route that is not listed', () => {
    expect(isSharedCacheableRoute('/browse')).toBe(false);
  });
});

describe('normalisePath', () => {
  it('keeps the root as /', () => {
    expect(normalisePath('/')).toBe('/');
  });

  it('drops a trailing slash', () => {
    expect(normalisePath('/gifts/')).toBe('/gifts');
  });

  it('adds a leading slash', () => {
    expect(normalisePath('gifts')).toBe('/gifts');
  });

  it('drops the query string', () => {
    expect(normalisePath('/gifts?sort=new')).toBe('/gifts');
  });
});
