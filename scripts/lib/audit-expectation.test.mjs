import { describe, it, expect } from 'vitest';
import {
  expectationSelectors,
  findRenderedExpectation,
  isExpectedPath,
  matchesPathPattern,
} from './audit-expectation.mjs';

// A stub page: it holds the selectors that are "on the page" and
// answers null for the rest, which is the contract the audit uses.
function stubPage(present = []) {
  return {
    $: async (selector) => (present.includes(selector) ? { selector } : null),
  };
}

describe('expectationSelectors', () => {
  it('returns the single expect selector', () => {
    expect(expectationSelectors({ expect: '.lb-hero' })).toEqual(['.lb-hero']);
  });

  it('returns every accepted alternative', () => {
    expect(expectationSelectors({ expectAny: ['.a', '.b'] })).toEqual(['.a', '.b']);
  });

  it('puts the expect selector first', () => {
    expect(expectationSelectors({ expect: '.a', expectAny: ['.b'] })).toEqual(['.a', '.b']);
  });

  it('is empty for a route that declares nothing', () => {
    expect(expectationSelectors({})).toEqual([]);
  });
});

describe('matchesPathPattern', () => {
  it('matches a literal path', () => {
    expect(matchesPathPattern('/login', '/login')).toBe(true);
  });

  it('matches any segment for a :placeholder', () => {
    expect(matchesPathPattern('/u/abc123', '/u/:handle')).toBe(true);
  });

  it('does not match a different segment count', () => {
    expect(matchesPathPattern('/u/abc123/edit', '/u/:handle')).toBe(false);
  });

  it('does not match a different literal segment', () => {
    expect(matchesPathPattern('/u/abc123/edit', '/u/:handle/edit')).toBe(true);
    expect(matchesPathPattern('/u/abc123/other', '/u/:handle/edit')).toBe(false);
  });
});

describe('isExpectedPath', () => {
  it('accepts the path the route asked for', () => {
    expect(isExpectedPath('/onboarding', { path: '/onboarding' })).toBe(true);
  });

  it('rejects an undeclared redirect', () => {
    expect(isExpectedPath('/login', { path: '/onboarding' })).toBe(false);
  });

  it('accepts a declared redirect', () => {
    expect(isExpectedPath('/login', { path: '/onboarding', redirectsTo: '/login' })).toBe(true);
  });

  it('accepts a declared redirect with a placeholder', () => {
    const route = { path: '/u/me', redirectsTo: '/u/:handle' };
    expect(isExpectedPath('/u/abc123', route)).toBe(true);
  });
});

describe('findRenderedExpectation', () => {
  it('reports the selector that is present', async () => {
    const result = await findRenderedExpectation(stubPage(['.lb-field--avatar']), [
      '.lb-field--avatar',
    ]);
    expect(result.ok).toBe(true);
    expect(result.matched).toBe('.lb-field--avatar');
  });

  it('accepts one of several alternatives', async () => {
    const result = await findRenderedExpectation(stubPage(['.b']), ['.a', '.b']);
    expect(result.ok).toBe(true);
    expect(result.matched).toBe('.b');
  });

  it('reports a gap when the expected element is absent', async () => {
    const result = await findRenderedExpectation(stubPage([]), ['.lb-field--avatar'], 200, 50);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('.lb-field--avatar');
  });

  it('reports a config gap when the route declares no expectation', async () => {
    const result = await findRenderedExpectation(stubPage([]), []);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no expectation declared');
  });
});
