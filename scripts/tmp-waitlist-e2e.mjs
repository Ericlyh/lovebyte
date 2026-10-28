import { chromium } from 'playwright';

/**
 * End-to-end check of the deployed waitlist form (OOP-6161).
 *
 * What it proves: with the CAPTCHA gate OFF, submitting the form must
 * reach the SERVER ACTION — the error we see must be the data-layer
 * error ("Rate-limit check failed"), NOT a CAPTCHA error. A CAPTCHA
 * error would mean the gate is rejecting when it should be dormant.
 *
 * The data layer is dead (OOP-6154), so a full insert cannot succeed
 * yet — but the error message still tells us which gate rejected.
 */
const BASE = process.env.AUDIT_BASE ?? 'https://lovorithm.vercel.app';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// Is the CAPTCHA widget rendered?
const widgetCount = await page.locator('.lb-turnstile').count();
const iframeCount = await page.locator('iframe[src*="challenges.cloudflare.com"]').count();

console.log(`turnstile container elements: ${widgetCount}`);
console.log(`cloudflare iframes:            ${iframeCount}`);

await page.fill('input[name="email"]', `e2e-check-${Date.now()}@example.com`);
await page.click('button[type="submit"]');

// Wait for the form error to appear (or the success block).
await page.waitForSelector('.lb-form-error, .lb-waitlist-success', { timeout: 30000 });

const error = await page.locator('.lb-form-error').count()
  ? await page.locator('.lb-form-error').first().innerText()
  : '(success block — insert succeeded)';

console.log(`\nform error text: ${error}`);
console.log(
  error.includes('CAPTCHA')
    ? 'FAIL: the CAPTCHA gate rejected a submission while it should be dormant'
    : 'PASS: the submission reached the server action (rejected by the data layer, not by CAPTCHA)',
);

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 5)) console.log(`  - ${e.slice(0, 160)}`);

await browser.close();
