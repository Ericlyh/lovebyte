// Mobile-responsive audit at 360px (iPhone SE width).
// Visits each shipped route, measures whether the body horizontally
// overflows the viewport, and dumps any element wider than 360px.
//
// Usage:  pnpm dev   (in another terminal, leave running)
//         node scripts/mobile-audit.mjs
//
// Phase 9 (OOP-4225) — acceptance criterion: every page renders
// usably at 360px width.

import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3100';

const ROUTES = [
  { path: '/', label: 'landing' },
  { path: '/browse', label: 'browse' },
  { path: '/g/demo', label: 'recipient-demo' },
  { path: '/l/00000000-0000-0000-0000-000000000000', label: 'listing-bad' },
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/create', label: 'create' },
  { path: '/onboarding', label: 'onboarding' },
  { path: '/u/arjun', label: 'profile-arjun' },
  { path: '/random-404', label: '404' },
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const results = [];

for (const { path, label } of ROUTES) {
  const page = await context.newPage();
  const url = `${BASE}${path}`;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800); // let streaming + skeletons settle
    const status = resp?.status() ?? 0;

    const audit = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      const docWidth = Math.max(body.scrollWidth, html.scrollWidth);
      const winWidth = window.innerWidth;
      const overflow = docWidth > winWidth;

      // Find any element wider than the viewport (causes horizontal scroll).
      const wideEls = [];
      if (overflow) {
        const all = document.querySelectorAll('*');
        for (const el of all) {
          const r = el.getBoundingClientRect();
          if (r.right > winWidth + 1) {
            const sel =
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (el.className && typeof el.className === 'string'
                ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
                : '');
            wideEls.push({ sel, right: Math.round(r.right), width: Math.round(r.width) });
          }
        }
      }

      // Detect forms with tiny tap targets (< 36px tall).
      const tinyButtons = [];
      const buttons = document.querySelectorAll('button, input[type=submit], a[role=button]');
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 36) {
          tinyButtons.push({
            sel: b.tagName.toLowerCase() + (b.textContent ? `:${b.textContent.trim().slice(0, 20)}` : ''),
            height: Math.round(r.height),
          });
        }
      }

      // Detect text wider than viewport (single-line overflow).
      const longLines = [];
      const textEls = document.querySelectorAll('h1, h2, h3, p, blockquote');
      for (const el of textEls) {
        if (el.scrollWidth > winWidth + 1) {
          longLines.push({
            sel: el.tagName.toLowerCase(),
            scrollWidth: el.scrollWidth,
            text: el.textContent?.trim().slice(0, 40) ?? '',
          });
        }
      }

      return {
        docWidth,
        winWidth,
        overflow,
        wideEls: wideEls.slice(0, 8),
        tinyButtons: tinyButtons.slice(0, 8),
        longLines: longLines.slice(0, 5),
      };
    });

    results.push({ label, path, status, ...audit });
  } catch (err) {
    results.push({ label, path, error: err.message.slice(0, 100) });
  }
  await page.close();
}

await browser.close();

console.log('\n=== Mobile Audit @ 360px ===\n');
const fail = [];
for (const r of results) {
  if (r.error) {
    console.log(`❌ ${r.label.padEnd(20)} ${r.path}  ERROR: ${r.error}`);
    fail.push(r.label);
    continue;
  }
  const status = r.status === 200 || r.status === 404 ? '✓' : '⚠';
  const overflow = r.overflow ? '❌ overflow' : '✓ fit';
  console.log(
    `${status} ${r.label.padEnd(20)} ${r.path.padEnd(50)} HTTP ${r.status}  ${overflow}  (doc ${r.docWidth}/win ${r.winWidth})`
  );
  if (r.overflow && r.wideEls.length) {
    for (const e of r.wideEls.slice(0, 4)) {
      console.log(`     ↳ ${e.sel.padEnd(40)} right=${e.right} width=${e.width}`);
    }
  }
  if (r.tinyButtons.length) {
    for (const b of r.tinyButtons.slice(0, 3)) {
      console.log(`     ↳ tiny tap target: ${b.sel} (${b.height}px)`);
    }
  }
  if (r.overflow) fail.push(r.label);
}

console.log(`\n=== Result: ${fail.length === 0 ? 'PASS' : `${fail.length} routes with horizontal overflow`} ===`);
console.log(fail.length ? fail.map((f) => `  - ${f}`).join('\n') : '');