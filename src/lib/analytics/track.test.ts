import { describe, expect, it } from 'vitest';
import { isPrefetchRequest } from './track';

/**
 * Prefetch detection tests (OOP-6716).
 *
 * The gift-open route increments `shares.view_count`, so a prefetch
 * counted as an open would inflate the number the sender sees. Next
 * marks its own segment-cache prefetches with `Next-Router-Prefetch`;
 * browsers mark theirs with `purpose: prefetch` (and the `Sec-Purpose`
 * / `X-Purpose` variants).
 */

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe('isPrefetchRequest', () => {
  it('treats a plain navigation as a real request', () => {
    expect(isPrefetchRequest(headers({ 'user-agent': 'Mozilla/5.0' }))).toBe(false);
  });

  it('recognises Next.js segment-cache prefetches', () => {
    expect(isPrefetchRequest(headers({ 'next-router-prefetch': '1' }))).toBe(true);
  });

  it("recognises the browser's own prefetch header", () => {
    expect(isPrefetchRequest(headers({ purpose: 'prefetch' }))).toBe(true);
    expect(isPrefetchRequest(headers({ 'sec-purpose': 'prefetch' }))).toBe(true);
    expect(isPrefetchRequest(headers({ 'x-purpose': 'prefetch' }))).toBe(true);
  });

  it('does not mistake an ordinary purpose header for a prefetch', () => {
    expect(isPrefetchRequest(headers({ purpose: 'navigate' }))).toBe(false);
  });
});
