// Mobile-responsive audit at 360px (iPhone SE width).
// Visits each shipped route, measures whether the body horizontally
// overflows the viewport, and dumps any element wider than 360px.
//
// Usage:
//   node scripts/mobile-audit.mjs
//   AUDIT_BASE=https://lovorithm.vercel.app node scripts/mobile-audit.mjs
//
// OOP-6735 — this script launched Playwright's BUNDLED Chromium, which
// is not installed on this host, so it crashed before it measured
// anything. It also carried its own (10-route) route list, so it never
// saw the builders, /settings, /purchases or the checkout pages. Both
// are fixed: the browser is the system Chrome (no download) and the
// route table is shared with the a11y audit
// (scripts/lib/audit-routes.mjs), so the two audits cannot drift apart
// again.
//
// Phase 9 (OOP-4225) — acceptance criterion: every page renders
// usably at 360px width.

import {
  AUDIT_ROUTES,
  expandRoutes,
  launchBrowser,
  readEnvLocal,
  resolveRouteParams,
  signInAsAuditUser,
} from './lib/audit-routes.mjs';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3100';

const env = readEnvLocal();
const params = await resolveRouteParams({ base: BASE, env });
const routes = expandRoutes(AUDIT_ROUTES, params);

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 360, height: 800 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

// The builders and the account pages need a session, or they bounce to
// /login and the audit measures the login page instead of the builder.
let session = null;
try {
  const signInPage = await context.newPage();
  session = await signInAsAuditUser({ page: signInPage, base: BASE, env });
  await signInPage.close();
  console.log(session ? 'signed in as a throwaway audit user' : 'no credentials — auth-gated routes will not be measured');
} catch (err) {
  console.log(`could not sign in (${err.message}) — auth-gated routes will not be measured`);
}

const results = [];

for (const { path, label, auth } of routes) {
  if (auth && !session) {
    results.push({ label, path, skipped: 'no session' });
    continue;
  }
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
if (session) await session.cleanup();

console.log('\n=== Mobile Audit @ 360px ===\n');
console.log(`base=${BASE}`);
console.log(`routes=${routes.length} ids=${JSON.stringify(params)}`);
const fail = [];
let skipped = 0;
for (const r of results) {
  if (r.skipped) {
    skipped++;
    console.log(`– ${r.label.padEnd(20)} ${r.path.padEnd(50)} not measured (${r.skipped})`);
    continue;
  }
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

console.log(
  `\n=== Result: ${fail.length === 0 ? 'PASS' : `${fail.length} routes with horizontal overflow`} (${results.length - skipped} measured, ${skipped} skipped) ===`
);
console.log(fail.length ? fail.map((f) => `  - ${f}`).join('\n') : '');

// A gate that only prints cannot gate anything (OOP-6735).
if (fail.length > 0) {
  console.error(`\n✗ FAIL — ${fail.length} route(s) overflow horizontally at 360px.`);
  process.exit(1);
}
console.log('\n✓ PASS — every measured route fits 360px.');
