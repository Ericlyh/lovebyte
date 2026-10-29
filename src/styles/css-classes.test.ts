import { beforeAll, describe, expect, it } from 'vitest';
import { findOrphanClasses } from '../../scripts/check-css-classes.mjs';

/**
 * Every `className` the TSX applies must have a CSS rule (OOP-6734).
 *
 * A class with no rule is invisible: the page still loads, Lighthouse
 * still scores, axe still passes. It just quietly does nothing. That is
 * how `lb-btn--block` — applied to the checkout Pay button and to every
 * auth form — left those CTAs at 220px inside a 376px form for as long
 * as it existed.
 *
 * The extractor walks the TSX with the TypeScript compiler API, so a
 * template-literal class (`lb-memory-card--${cardState}`) is resolved
 * through the type checker rather than pattern-matched, and a Tailwind
 * utility is confirmed with Tailwind itself. What is left over is an
 * orphan, and an orphan fails this test.
 */
describe('CSS class coverage', () => {
  // One program build for both assertions — the type checker is the
  // expensive part, not the assertions.
  let orphans: Map<string, Set<string>>;
  let unresolved: { prefix: string; file: string; line: number }[];

  beforeAll(async () => {
    const result = await findOrphanClasses();
    orphans = result.orphans;
    unresolved = result.unresolved;
  }, 300_000);

  it('has a rule for every class the TSX applies', () => {
    const orphanList = [...orphans.entries()]
      .map(([name, files]) => `${name} — ${[...files].sort().join(', ')}`)
      .sort();

    expect(orphanList).toEqual([]);
  });

  it('resolves every dynamic class variant', () => {
    expect(
      unresolved.map((item) => `${item.prefix} in ${item.file}:${item.line}`),
    ).toEqual([]);
  });
});
