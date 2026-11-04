#!/usr/bin/env node
/**
 * The global error boundary, checked in a browser (OOP-6737).
 *
 * Next does not let a segment's `error.tsx` catch an error thrown in that
 * segment's own `layout.tsx`. Without a `global-error.tsx`, such a throw
 * renders Next's own error page — "This page couldn't load. A server error
 * occurred." — with no branding, no styles and no language.
 *
 * The check needs a layout that actually throws, and it needs a BROWSER:
 * the server sends Next's `__next_error__` shell with the boundary in the
 * flight payload, and the branded card only appears once React has
 * hydrated it. A `curl` sees the shell and would call it a pass.
 *
 * How to run it:
 *
 *   1. build the app:            pnpm build
 *   2. start it with the trigger: LOVEBYTE_FORCE_LAYOUT_ERROR=1 pnpm start
 *   3. check it:                 node scripts/check-global-error.mjs http://127.0.0.1:3000
 *
 * The trigger lives in `src/app/[locale]/layout.tsx` and is inert unless
 * that env var is exactly '1'.
 */

import { chromium } from 'playwright';

const base = (process.argv[2] ?? process.env.AUDIT_BASE ?? 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);

/** The routes that are rendered per request, so the layout runs. */
const ROUTES = ['/status', '/login'];

const browser = await chromium.launch({ channel: 'chrome' });
let failures = 0;

for (const path of ROUTES) {
  const page = await browser.newPage();
  const response = await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  const text = await page.evaluate(() => document.body.innerText);

  const problems = [];
  if (response.status() !== 500) problems.push(`status ${response.status()}, expected 500`);
  if (!/lb-empty-card/.test(html)) problems.push('the branded error card is not on the page');
  if (/This page couldn.t load|A server error occurred/.test(text)) {
    problems.push("Next's own error page is showing");
  }
  if (!/lang="[a-zA-Z-]+"/.test(html)) problems.push('the document declares no language');

  if (problems.length === 0) {
    console.log(`ok    ${path} — the branded error card rendered (HTTP 500)`);
  } else {
    failures += 1;
    console.error(`FAIL  ${path} — ${problems.join('; ')}`);
  }
  await page.close();
}

await browser.close();

if (failures > 0) {
  console.error(
    '\nThe global error boundary did not take over. Is LOVEBYTE_FORCE_LAYOUT_ERROR=1 set on the server?',
  );
  process.exit(1);
}
console.log('\nglobal error: OK — a throw in the root layout renders the Lovorithm card.');
