// OOP-8160 — "did the route render the page we meant to audit?"
//
// The a11y audit visits a route, runs axe on whatever page is there and
// records the URL it ended on. The URL was PRINTED but never ASSERTED, so
// a route that renders something OTHER than its intended page counted as
// measured and clean.
//
// The concrete case: /onboarding renders an error card instead of the
// onboarding form when its profile read fails. The error card sits at the
// SAME url, so the audit read "clean" while there was no form, no input
// and nothing to violate — and it hid a real critical defect (a file
// input with no accessible name) for a week.
//
// The fix: every route declares the element its intended render must
// carry. If the element is not there, the route was NOT MEASURED — it is
// reported in the skipped total, it never counts as clean, and the run
// fails with a coverage gap.
//
// This module is deliberately free of any Playwright import so it can be
// unit-tested against a stub page.

/**
 * The selectors a route is allowed to render.
 *
 * `expect` is the one element the intended page always has. `expectAny`
 * is for a route that legitimately renders one of several pages (an
 * expired gift, an empty catalogue) — at least one of them must be
 * present. A route with neither is a config gap and is reported as such.
 *
 * @param {{expect?: string, expectAny?: string[]}} route
 * @returns {string[]}
 */
export function expectationSelectors(route) {
  return [...(route.expect ? [route.expect] : []), ...(route.expectAny ?? [])];
}

/**
 * The paths a route is allowed to end on when it redirects.
 *
 * The audit records the path the browser ended on. A route that bounced
 * to /login (or to the not-found page) was not the page we meant to
 * audit, so unless the route declares the redirect as expected, the
 * bounce is a coverage gap.
 *
 * A declared path may carry `:segments` — they match any single
 * segment. /u/me redirects to /u/<the viewer's own handle>, which is
 * not knowable when the table is written.
 *
 * @param {{redirectsTo?: string | string[]}} route
 * @returns {string[]}
 */
export function allowedFinalPaths(route) {
  if (!route.redirectsTo) return [];
  return Array.isArray(route.redirectsTo) ? route.redirectsTo : [route.redirectsTo];
}

/**
 * Does a path match a pattern? `:segment` matches any one segment.
 *
 * @param {string} path
 * @param {string} pattern
 * @returns {boolean}
 */
export function matchesPathPattern(path, pattern) {
  const pathParts = path.split('/');
  const patternParts = pattern.split('/');
  if (pathParts.length !== patternParts.length) return false;
  return patternParts.every(
    (part, i) => part.startsWith(':') || part === pathParts[i],
  );
}

/**
 * Is the final path an expected one for this route?
 *
 * @param {string} finalPath the path the browser ended on
 * @param {{path: string, redirectsTo?: string | string[]}} route
 * @returns {boolean}
 */
export function isExpectedPath(finalPath, route) {
  if (finalPath === route.path) return true;
  return allowedFinalPaths(route).some((pattern) => matchesPathPattern(finalPath, pattern));
}

/**
 * Wait for ONE of the route's expected elements to appear.
 *
 * The page may still be streaming its content when the audit arrives
 * (OOP-6738), so a single instant check would be a false gap. The poll
 * is bounded so a route that never renders its expected element fails in
 * seconds rather than hanging the gate.
 *
 * @param {{$: (selector: string) => Promise<unknown>}} page
 * @param {string[]} selectors
 * @param {number} timeoutMs
 * @param {number} pollMs
 * @returns {Promise<{ok: boolean, matched: string | null, reason: string}>}
 */
export async function findRenderedExpectation(page, selectors, timeoutMs = 3000, pollMs = 200) {
  if (!selectors || selectors.length === 0) {
    return { ok: false, matched: null, reason: 'no expectation declared' };
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const selector of selectors) {
      const handle = await page.$(selector).catch(() => null);
      if (handle) return { ok: true, matched: selector, reason: '' };
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return {
    ok: false,
    matched: null,
    reason: `expected ${selectors.join(' or ')} not found`,
  };
}
