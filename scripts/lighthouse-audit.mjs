// Lighthouse audit on the four key pages.
// Phase 9 (OOP-4225) — acceptance criterion: Lighthouse ≥90 on /,
// /g/[token], /api/og/[token].
//
// Usage:  pnpm dev   (in another terminal, leave running)
//         node scripts/lighthouse-audit.mjs

import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3100';

const TARGETS = [
  '/',
  '/g/demo',
  '/api/og/demo',
  '/browse',
];

const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage'],
});

console.log('\n=== Lighthouse Audit ===\n');

let allPass = true;
for (const path of TARGETS) {
  const url = `${BASE}${path}`;
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });
    const cats = result.lhr.categories;
    const scores = {
      perf: Math.round(cats.performance.score * 100),
      a11y: Math.round(cats.accessibility.score * 100),
      bp: Math.round(cats['best-practices'].score * 100),
      seo: Math.round(cats.seo.score * 100),
    };
    const passed = scores.perf >= 90 && scores.a11y >= 90 && scores.bp >= 90 && scores.seo >= 90;
    const mark = passed ? '✓' : '⚠';
    if (!passed) allPass = false;
    console.log(
      `${mark} ${path.padEnd(30)} ` +
        `perf=${scores.perf} a11y=${scores.a11y} bp=${scores.bp} seo=${scores.seo}`
    );
  } catch (err) {
    console.log(`❌ ${path.padEnd(30)} ERROR: ${err.message.slice(0, 100)}`);
    allPass = false;
  }
}

await chrome.kill();

console.log(`\n=== Result: ${allPass ? 'PASS (all ≥90)' : 'see warnings above'} ===\n`);