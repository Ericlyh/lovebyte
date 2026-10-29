import { describe, expect, it } from 'vitest';
import { sanitizeNextPath } from './next-path';

/**
 * Tests for the `?next=` return-path guard.
 *
 * A return path is attacker-controlled, so the cases that matter most
 * are the ones that try to leave the site.
 */

describe('sanitizeNextPath', () => {
  it('accepts a same-origin path', () => {
    expect(sanitizeNextPath('/g/lovebyte-demo-2026/open')).toBe(
      '/g/lovebyte-demo-2026/open',
    );
    expect(sanitizeNextPath('/l/aaaa1111-0000-0000-0000-000000000001')).toBe(
      '/l/aaaa1111-0000-0000-0000-000000000001',
    );
  });

  it('keeps the query string and the hash', () => {
    expect(sanitizeNextPath('/g/demo/open?a=1#x')).toBe('/g/demo/open?a=1#x');
  });

  it('rejects a protocol-relative URL', () => {
    expect(sanitizeNextPath('//evil.com/g/demo')).toBeNull();
  });

  it('rejects a backslash path — browsers treat it as a slash', () => {
    expect(sanitizeNextPath('/\\evil.com')).toBeNull();
    expect(sanitizeNextPath('\\\\evil.com')).toBeNull();
  });

  it('rejects an absolute URL', () => {
    expect(sanitizeNextPath('https://evil.com/g/demo')).toBeNull();
    expect(sanitizeNextPath('javascript:alert(1)')).toBeNull();
    expect(sanitizeNextPath('data:text/html,x')).toBeNull();
  });

  it('rejects a relative path', () => {
    expect(sanitizeNextPath('g/demo')).toBeNull();
    expect(sanitizeNextPath('./g/demo')).toBeNull();
  });

  it('rejects an empty or missing value', () => {
    expect(sanitizeNextPath('')).toBeNull();
    expect(sanitizeNextPath('   ')).toBeNull();
    expect(sanitizeNextPath(null)).toBeNull();
    expect(sanitizeNextPath(undefined)).toBeNull();
  });
});
