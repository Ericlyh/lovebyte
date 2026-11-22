import { describe, it, expect } from 'vitest';
import { AUDIT_ROUTES } from './audit-routes.mjs';
import { expectationSelectors } from './audit-expectation.mjs';

// OOP-8160 — a route with no expectation is a blind spot: the audit
// measures whatever it lands on and reports it as clean. The table is
// the contract, so a route added without an expectation fails here
// rather than quietly widening the blind spot.
describe('AUDIT_ROUTES', () => {
  it('gives every route an expectation', () => {
    const missing = AUDIT_ROUTES.filter((r) => expectationSelectors(r).length === 0).map(
      (r) => r.label,
    );
    expect(missing).toEqual([]);
  });

  it('gives every route a path and a label', () => {
    const broken = AUDIT_ROUTES.filter((r) => !r.path || !r.label).map((r) => String(r.path));
    expect(broken).toEqual([]);
  });

  it('gives every route a unique label', () => {
    const labels = AUDIT_ROUTES.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('declares the expectation as a plain selector', () => {
    // No combinators, no whitespace, no pseudo-classes: the expectation
    // has to be a single element the audit can look up.
    const odd = AUDIT_ROUTES.flatMap((r) =>
      expectationSelectors(r)
        .filter((sel) => /[\s>+~:]/.test(sel))
        .map((sel) => `${r.label}: ${sel}`),
    );
    expect(odd).toEqual([]);
  });
});
