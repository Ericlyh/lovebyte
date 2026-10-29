import { chromium } from 'playwright';

/**
 * Soft-404 status check (OOP-6729).
 *
 * Three routes used to answer a resource that does not exist with HTTP
 * 200 and a "Gift not found" page: /l/[giftId], /checkout/[giftId] and
 * /g/[token]. A crawler reads that as a real, indexable page, so every
 * guessed gift UUID was a page in the index — an endless URL space.
 *
 * This script asserts the thing that actually matters: the STATUS CODE
 * the server returns, and that the body is the app's own not-found
 * surface (not a sad title rendered with a 200).
 *
 * The fast half of the regression cover is
 * `src/app/[locale]/not-found-routes.test.ts` (runs in `pnpm test`);
 * this is the half that talks to a real server.
 *
 * Usage:
 *   node scripts/notfound-status-e2e.mjs
 *   AUDIT_BASE=http://127.0.0.1:4311 node scripts/notfound-status-e2e.mjs
 */
const BASE = process.env.AUDIT_BASE ?? 'https://lovorithm.vercel.app';

/**
 * `expectText` is matched against the text the browser actually shows,
 * so a route that answered 404 with the WRONG page fails too.
 */
const CASES = [
  {
    name: '/l/<unknown gift id>',
    path: '/l/00000000-0000-0000-0000-000000000000',
    status: 404,
    expectText: /couldn.t find that page/i,
  },
  {
    name: '/checkout/<unknown gift id>',
    path: '/checkout/00000000-0000-0000-0000-000000000000',
    status: 404,
    expectText: /couldn.t find that page/i,
  },
  {
    name: '/g/<unknown share token>',
    path: '/g/zzzzzzzz',
    status: 404,
    expectText: /isn.t here anymore/i,
  },
  {
    // The control route. It has always answered 404 and must not
    // regress while the other three are brought in line with it.
    name: '/u/<unknown handle>',
    path: '/u/nobody-here',
    status: 404,
    expectText: /couldn.t find that page/i,
  },
  {
    // The positive control: a gift link that DOES resolve must still be
    // a 200 with the envelope on it. /g/demo is seeded in
    // src/lib/gifts/mock.ts for exactly this purpose.
    name: '/g/demo (a link that resolves)',
    path: '/g/demo',
    status: 200,
    expectText: /sent you something|Lovorithm/i,
  },
];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

try {
  for (const c of CASES) {
    const url = `${BASE}${c.path}`;
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      check(c.name, false, `navigation failed: ${error.message}`);
      continue;
    }
    const status = response?.status() ?? 0;
    if (status !== c.status) {
      check(c.name, false, `expected HTTP ${c.status}, got ${status}`);
      continue;
    }
    // The not-found surface is delivered in the RSC payload and painted
    // by the client, so wait for it rather than reading the DOM the
    // instant the document parsed.
    let text = '';
    try {
      await page.getByText(c.expectText).first().waitFor({ timeout: 15000 });
      text = await page.locator('body').innerText();
    } catch {
      text = await page.locator('body').innerText();
      check(
        c.name,
        false,
        `HTTP ${status} but the body is not the not-found page: ${JSON.stringify(text.slice(0, 120))}`,
      );
      continue;
    }
    // The old soft-404 page said "Gift not found" and was served with a
    // 200. It must not come back in any shape.
    if (/gift not found/i.test(text)) {
      check(c.name, false, 'the body is still the old "Gift not found" page');
      continue;
    }
    check(c.name, true, `HTTP ${status}`);
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed against ${BASE}`,
);
if (failed.length) process.exit(1);
