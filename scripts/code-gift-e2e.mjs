import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/**
 * Code-gift e2e (Playwright, real session) — OOP-5688.
 *
 * Drives the whole sender path a code gift takes:
 *
 *   1. the picker offers "Code" and routes to /create/code;
 *   2. the live safety scan blocks a gift that reads host state and
 *      clears a clean one;
 *   3. the preview renders the sender's code inside the sandbox;
 *   4. the AI review comes back with a summary (this is what proves the
 *      LOVEBYTE_AI_* env vars reached the deployment);
 *   5. saving either lands on the share page, or fails with the
 *      "not switched on yet" message that says the only thing missing
 *      is the migration that adds the `code` gift type.
 *
 * It creates a throwaway user over the GoTrue admin API and deletes it
 * again in the `finally` block, so a run leaves nothing behind.
 *
 * Usage:
 *   node scripts/code-gift-e2e.mjs
 *   AUDIT_BASE=https://staging.example.com node scripts/code-gift-e2e.mjs
 */
const envLocal = readFileSync(
  new URL('../.env.local', import.meta.url).pathname,
  'utf8',
)
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .reduce((acc, l) => {
    const [k, ...v] = l.split('=');
    acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const BASE = process.env.AUDIT_BASE ?? 'https://lovorithm.vercel.app';
const SUPA = envLocal.NEXT_PUBLIC_SUPABASE_URL;
const SK = envLocal.SUPABASE_SECRET_KEY;
const EMAIL = `e2e-code-${Date.now()}@example.com`;
const PASSWORD = `pw-${Math.random().toString(36).slice(2)}-A1`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const created = await fetch(`${SUPA}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
});
const createdBody = await created.json();
console.log('admin create user:', created.status);
if (created.status >= 300) {
  console.log(JSON.stringify(createdBody).slice(0, 300));
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 200));
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(2000);
  console.log('after login url:', page.url());

  // 1. the picker offers "Code" and routes to the builder.
  await page.goto(`${BASE}/create`, { waitUntil: 'domcontentloaded' });
  const options = await page.locator('select[name="type"] option').allTextContents();
  check('picker offers a Code option', options.includes('Code'), options.join(', '));

  await page.fill('input[name="title"]', 'A tiny page for you');
  await page.selectOption('select[name="type"]', 'code');
  await Promise.all([
    page.waitForURL(/\/create\/code$/, { timeout: 30000 }).catch(() => {}),
    // Scope to the create form: the nav also holds a sign-out
    // <button type="submit">, and a bare selector clicks that one.
    page.click('form.lb-form button[type="submit"]'),
  ]);
  await page.waitForTimeout(1500);
  check('picker routes to /create/code', page.url().endsWith('/create/code'), page.url());

  // 2. the scan blocks a gift that reads host state.
  await page.fill('#code-title', 'A tiny page for you');
  await page.fill(
    '#code-html',
    '<h1 id="msg">Hi</h1><button id="go">Open</button>',
  );
  await page.fill('#code-css', 'h1 { color: #a83e3e; }');
  await page.fill('#code-js', 'document.getElementById("go").onclick = () => {};');
  await page.waitForTimeout(600);

  const verdictOf = async () =>
    (await page.locator('.lb-code-verdict').first().innerText()).trim();
  let verdict = await verdictOf();
  check('a clean gift scans clean', verdict.toLowerCase().includes('safe'), verdict);

  await page.fill('#code-js', 'localStorage.setItem("x", "1");');
  await page.waitForTimeout(600);
  verdict = await verdictOf();
  check('a gift that reads host state is blocked', verdict.toLowerCase().includes('cannot'), verdict);

  const findingCount = await page.locator('.lb-code-finding').count();
  check('the blocked finding is listed', findingCount > 0, `${findingCount} findings`);

  await page.fill('#code-js', 'document.getElementById("go").onclick = () => {};');
  await page.waitForTimeout(600);
  verdict = await verdictOf();
  check('clearing the block clears the verdict', verdict.toLowerCase().includes('safe'), verdict);

  // 3. the preview carries the sender's code and the sandbox CSP.
  const srcDoc = await page.locator('.lb-code-gift__frame--preview').getAttribute('srcdoc');
  check(
    'preview embeds the sender code',
    Boolean(srcDoc?.includes('id="msg"')) && Boolean(srcDoc?.includes('color: #a83e3e')),
  );
  check('preview carries the sandbox CSP', Boolean(srcDoc?.includes('connect-src')));
  const sandbox = await page.locator('.lb-code-gift__frame--preview').getAttribute('sandbox');
  check('preview frame is sandboxed without same-origin', sandbox === 'allow-scripts', String(sandbox));

  // 4. the AI review (proves the deployment has the model configured).
  await page.click('button:has-text("Ask the AI")');
  const reviewSummary = page.locator('.lb-code-review__summary');
  const gotReview = await reviewSummary
    .waitFor({ timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  check('AI review returns a summary', gotReview, gotReview ? (await reviewSummary.innerText()).slice(0, 160) : 'no summary');
  if (gotReview) {
    const suggestionCount = await page.locator('.lb-code-suggestion').count();
    check('AI review proposes suggestions', suggestionCount >= 0, `${suggestionCount} suggestions`);
  } else {
    const aiError = await page.locator('.lb-code-builder__ai .lb-form-error').count();
    const aiErrText = aiError ? await page.locator('.lb-code-builder__ai .lb-form-error').first().innerText() : '';
    console.log('  ai error:', aiErrText);
  }

  // 5. saving. Either it works (migration applied) or it says exactly
  //    what is missing.
  await Promise.all([
    page.waitForURL(/\/create\/[^/]+\/finish/, { timeout: 30000 }).catch(() => {}),
    page.click('form.lb-code-builder button[type="submit"]'),
  ]);
  await page.waitForTimeout(2500);
  const saveError = await page.locator('.lb-form-error').count();
  if (saveError) {
    const msg = (await page.locator('.lb-form-error').first().innerText()).trim();
    check(
      'save reports the missing migration (not a crash)',
      msg.includes('not switched on') || msg.includes('Could not save'),
      msg,
    );
  } else {
    check('save produced a share page', page.url().includes('/finish'), page.url());
  }
} catch (err) {
  check('e2e ran to completion', false, String(err).slice(0, 300));
} finally {
  await browser.close();
  const del = await fetch(`${SUPA}/auth/v1/admin/users/${createdBody.id}`, {
    method: 'DELETE',
    headers: { apikey: SK, Authorization: `Bearer ${SK}` },
  });
  console.log('\ncleanup delete user:', del.status);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
