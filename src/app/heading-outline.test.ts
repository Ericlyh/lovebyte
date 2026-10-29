import { describe, expect, it } from 'vitest';
import { findHeadingProblems } from '../../scripts/lib/heading-outline.mjs';

/**
 * The heading outline (OOP-6738).
 *
 * axe has no rule for heading levels, so the accessibility audit would
 * read "0 violations" on a page whose outline was broken: WCAG 1.3.1
 * says a heading level must not be skipped, because a screen-reader
 * user navigating by heading level would be told that an h3 is a child
 * of a section that does not exist.
 *
 * The site had exactly that on /browse (an h1 followed by ten h3s), on
 * /support (an h1 followed by three h3s) and on / (an h2 followed by
 * three h4s). The logic is pure, so it is tested here without a
 * browser; the browser half is `readHeadingOutline`, used by
 * scripts/a11y-audit.mjs.
 */
describe('heading outline', () => {
  it('accepts an outline that never skips a level', () => {
    // The landing page after OOP-6738: h1 → h2 → h3s → h2 → h3s → h2.
    expect(findHeadingProblems([1, 2, 3, 3, 3, 2, 3, 3, 2])).toEqual([]);
  });

  it('accepts a level that goes DOWN', () => {
    // h3 after an h2 is a sibling section, not a skipped level.
    expect(findHeadingProblems([1, 2, 3, 2, 3])).toEqual([]);
  });

  it('reports a skipped level', () => {
    // The /browse case: an h1 followed by ten h3s.
    const problems = findHeadingProblems([1, 3, 3, 3]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: 'skipped-level',
      from: 1,
      to: 3,
      index: 1,
    });
  });

  it('reports the h2 → h4 skip on the landing page', () => {
    // The "Three steps." section: an h2 followed by three h4s.
    const problems = findHeadingProblems([1, 2, 4, 4, 4, 2]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'skipped-level', from: 2, to: 4 });
  });

  it('reports a page with no h1', () => {
    const problems = findHeadingProblems([2, 3]);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('h1-count');
  });

  it('reports a page with two h1s', () => {
    const problems = findHeadingProblems([1, 2, 1]);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('h1-count');
    expect(problems[0].detail).toContain('found 2');
  });

  it('reports a page with no headings at all', () => {
    const problems = findHeadingProblems([]);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('h1-count');
  });

  it('reports every problem on a page, not just the first', () => {
    const problems = findHeadingProblems([1, 3, 3, 5]);
    expect(problems.map((p) => p.kind)).toEqual([
      'skipped-level',
      'skipped-level',
    ]);
  });
});
