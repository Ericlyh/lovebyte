// The heading outline of a page, and what is wrong with it (OOP-6738).
//
// Why this exists at all: axe does not test heading levels. WCAG 1.3.1
// (Info and Relationships) says a heading level must not be skipped — a
// document that goes h1 → h3 tells a screen-reader user that the h3 is
// a child of the h1's parent, which does not exist — and the axe audit
// reads "0 violations" on such a page. The site had exactly that on
// /browse (an h1 followed by ten h3s), on /support (an h1 followed by
// three h3s) and on / (an h2 followed by three h4s).
//
// The check is deliberately pure: it takes the list of heading levels
// on a page and returns what is wrong with it, so it can be unit-tested
// without a browser. The browser part — reading the levels out of the
// rendered DOM — lives in `readHeadingOutline` below.

/**
 * Every heading on a page, in document order.
 *
 * @returns {Promise<{levels: number[], labels: string[]}>}
 */
export async function readHeadingOutline(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    return {
      levels: nodes.map((n) => Number(n.tagName.slice(1))),
      labels: nodes.map((n) => (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)),
    };
  });
}

/**
 * What is wrong with a heading outline.
 *
 * Two rules, both from the acceptance criteria of OOP-6738:
 *
 *   1. exactly one h1 per page — it is the page's title, and a second
 *      one means the page has two titles;
 *   2. no level may increase by more than 1 from the level before it —
 *      a skipped level is the WCAG 1.3.1 failure.
 *
 * A level that goes DOWN is fine (an h3 after an h2 is a sibling
 * section), and a page with no headings at all is reported by rule 1.
 *
 * @param {number[]} levels the heading levels in document order
 * @returns {{kind: string, detail: string, index?: number, from?: number, to?: number}[]}
 */
export function findHeadingProblems(levels) {
  const problems = [];

  const h1Count = levels.filter((l) => l === 1).length;
  if (h1Count !== 1) {
    problems.push({
      kind: 'h1-count',
      detail: `expected exactly one h1, found ${h1Count}`,
    });
  }

  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] - levels[i - 1] > 1) {
      problems.push({
        kind: 'skipped-level',
        index: i,
        from: levels[i - 1],
        to: levels[i],
        detail: `h${levels[i - 1]} is followed by h${levels[i]}`,
      });
    }
  }

  return problems;
}
