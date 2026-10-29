// Lighthouse audit on the key pages.
//
// Usage:
//   node scripts/lighthouse-audit.mjs
//   AUDIT_BASE=https://lovorithm.vercel.app node scripts/lighthouse-audit.mjs
//
// Phase 9 (OOP-4225) — acceptance criterion: Lighthouse ≥90 on the key
// pages.
//
// OOP-6735 — this script RAN, but it could never pass:
//
//   1. its target list included `/api/og/demo`, an IMAGE endpoint. A PNG
//      has no accessibility score, no SEO score and no performance
//      score, so Lighthouse reported 0 for every category and `allPass`
//      was always false. The script then printed "see warnings above"
//      and exited 0 — a gate that always fails and always passes.
//
//   2. it never set an exit code, so even a real failure gated nothing.
//
//   3. it took ONE Lighthouse sample per route and compared it against a
//      threshold. OOP-6548 measured the UNCHANGED homepage ten times and
//      got perf = 81, 87, 93, 94, 96, 97, 97, 99, 99, 99 — an 18-point
//      spread around the 90 threshold. One sample against that
//      threshold is a coin flip. This takes the MEDIAN of N samples,
//      the same estimator the readiness gate uses.
//
//   4. it scored the SEO category on a page the site deliberately keeps
//      out of the index. The gift envelope (/g/<token>) is Disallowed
//      in robots.txt — the token is the access control — so Lighthouse
//      read "Page is blocked from indexing" and reported seo=63. A page
//      the site hides on purpose is not an SEO failure. Such a page is
//      scored on performance, accessibility and best-practices (the
//      visitor already holding the link still deserves all three) and
//      its SEO score is reported as n/a.
//
// Thresholds (override with env):
//   LH_PERF_MIN default 90   performance score
//   LH_A11Y_MIN default 90   accessibility score
//   LH_BP_MIN   default 90   best-practices score
//   LH_SEO_MIN  default 90   SEO score
//   LH_SAMPLES  default 3    samples per route; the MEDIAN is scored

import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3100';

const PERF_MIN = Number(process.env.LH_PERF_MIN ?? 90);
const A11Y_MIN = Number(process.env.LH_A11Y_MIN ?? 90);
const BP_MIN = Number(process.env.LH_BP_MIN ?? 90);
const SEO_MIN = Number(process.env.LH_SEO_MIN ?? 90);
const SAMPLES = Math.max(1, Number(process.env.LH_SAMPLES ?? 3));

// HTML pages only. An image or a JSON endpoint cannot be scored by
// Lighthouse — it returns 0 for every category, which is not a
// measurement, it is a category that does not exist for that URL.
const TARGETS = ['/', '/browse', '/g/demo', '/support'];

/** Median of a numeric sample. Even-length medians average the two middles. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Refuse to score a URL that is not an HTML page.
 *
 * This is the check that would have caught `/api/og/demo` on the day it
 * was added to the list. A non-HTML target used to report perf=0
 * a11y=0 bp=0 seo=0, which read like a catastrophic regression and
 * meant nothing at all. Now it says what it is.
 */
async function isHtmlPage(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    return { html: type.includes('text/html'), type, status: res.status };
  } catch (err) {
    return { html: false, type: '', status: 0, error: err.message };
  }
}

/**
 * Is this path disallowed by the site's own robots.txt?
 *
 * The gift envelope (/g/<token>) is deliberately unindexable — the
 * token is the access control, so the whole prefix is Disallowed. That
 * is correct, and Lighthouse's SEO category reads it as a failure
 * ("Page is blocked from indexing", seo=63), because SEO is a score for
 * pages that are MEANT to be in an index. Scoring SEO on a page the
 * site deliberately hides would make the gate fail on the site's own
 * privacy policy.
 *
 * So: a page the site disallows is scored on performance, accessibility
 * and best-practices — the things that matter for the visitor who is
 * already holding the link — and its SEO score is reported as "n/a".
 *
 * robots.txt matching, per the search-engine spec: a rule matches when
 * the URL path starts with the rule; `*` is any run of characters and
 * `$` anchors the end.
 */
async function loadRobotsRules() {
  try {
    const res = await fetch(`${BASE}/robots.txt`, { redirect: 'follow' });
    if (!res.ok) return [];
    const text = await res.text();
    return text
      .split('\n')
      .map((line) => line.match(/^\s*disallow:\s*(\S*)\s*$/i)?.[1])
      .filter((rule) => Boolean(rule));
  } catch {
    return [];
  }
}

function robotsDisallows(rules, path) {
  return rules.some((rule) => {
    const anchored = rule.endsWith('$');
    const body = anchored ? rule.slice(0, -1) : rule;
    const pattern = body
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp('^' + pattern + (anchored ? '$' : '')).test(path);
  });
}

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
});

console.log('\n=== Lighthouse Audit ===\n');
console.log(`base=${BASE} samples=${SAMPLES}`);

const robotsRules = await loadRobotsRules();

let allPass = true;
for (const path of TARGETS) {
  const url = `${BASE}${path}`;
  const kind = await isHtmlPage(path);
  if (!kind.html) {
    console.log(
      `❌ ${path.padEnd(30)} not an HTML page (${kind.type || kind.error || 'no content-type'}) — Lighthouse cannot score it`,
    );
    allPass = false;
    continue;
  }

  // A page the site deliberately keeps out of the index is not an SEO
  // failure — it is the site's own privacy policy working. It is still
  // scored on performance, accessibility and best-practices, because the
  // visitor holding the link still deserves all three.
  const unindexable = robotsDisallows(robotsRules, path);
  const categories = unindexable
    ? ['performance', 'accessibility', 'best-practices']
    : ['performance', 'accessibility', 'best-practices', 'seo'];

  try {
    const perf = [];
    const a11y = [];
    const bp = [];
    const seo = [];
    for (let i = 0; i < SAMPLES; i++) {
      const result = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: categories,
      });
      const cats = result.lhr.categories;
      perf.push(Math.round(cats.performance.score * 100));
      a11y.push(Math.round(cats.accessibility.score * 100));
      bp.push(Math.round(cats['best-practices'].score * 100));
      if (cats.seo) seo.push(Math.round(cats.seo.score * 100));
    }
    const scores = {
      perf: median(perf),
      a11y: median(a11y),
      bp: median(bp),
      seo: seo.length ? median(seo) : null,
    };
    const passed =
      scores.perf >= PERF_MIN &&
      scores.a11y >= A11Y_MIN &&
      scores.bp >= BP_MIN &&
      (scores.seo === null || scores.seo >= SEO_MIN);
    const mark = passed ? '✓' : '⚠';
    if (!passed) allPass = false;
    const seoText = scores.seo === null ? 'seo=n/a (disallowed by robots.txt)' : `seo=${scores.seo}`;
    console.log(
      `${mark} ${path.padEnd(30)} ` +
        `perf=${scores.perf} a11y=${scores.a11y} bp=${scores.bp} ${seoText}  ` +
        `(samples ${perf.join(',')})`,
    );
    if (!passed) {
      const shortfalls = [];
      if (scores.perf < PERF_MIN) shortfalls.push(`perf=${scores.perf} < ${PERF_MIN}`);
      if (scores.a11y < A11Y_MIN) shortfalls.push(`a11y=${scores.a11y} < ${A11Y_MIN}`);
      if (scores.bp < BP_MIN) shortfalls.push(`bp=${scores.bp} < ${BP_MIN}`);
      if (scores.seo !== null && scores.seo < SEO_MIN) shortfalls.push(`seo=${scores.seo} < ${SEO_MIN}`);
      console.log(`     below threshold: ${shortfalls.join(', ')}`);
    }
  } catch (err) {
    console.log(`❌ ${path.padEnd(30)} ERROR: ${err.message.slice(0, 100)}`);
    allPass = false;
  }
}

await chrome.kill();

console.log(`\n=== Result: ${allPass ? 'PASS (all ≥90)' : 'FAIL — see warnings above'} ===\n`);

// A gate that prints "see warnings above" and exits 0 gates nothing
// (OOP-6735). The exit code IS the verdict.
if (!allPass) {
  console.error('✗ FAIL — at least one route is below threshold.');
  process.exit(1);
}
console.log('✓ PASS — every target met its threshold.');
