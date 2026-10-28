import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

/**
 * Media-path e2e (Playwright, real session) — OOP-5816.
 *
 * Proves the whole product path a gift depends on: a signed-in creator
 * uploads a photo, and the URL the app hands back actually serves the
 * image to an anonymous browser (the recipient).
 *
 * The upload routes authenticate from the Supabase auth COOKIE, so a bare
 * bearer token gets 401. This drives the real /login form, then posts the
 * upload from inside the page so the cookies ride along.
 *
 * It creates a throwaway user over the GoTrue admin API and deletes it
 * again in the `finally` block, and deletes the uploaded object, so a
 * run leaves nothing behind.
 *
 * Usage:
 *   node scripts/media-e2e.mjs
 *   AUDIT_BASE=https://staging.example.com node scripts/media-e2e.mjs
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
const EMAIL = `e2e-media-${Date.now()}@example.com`;
const PASSWORD = `pw-${Math.random().toString(36).slice(2)}-A1`;

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
  if (m.type() === 'error') console.log('  [console error]', m.text().slice(0, 160));
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
  const loginErr = await page.locator('.lb-form-error').count();
  if (loginErr) console.log('  login error:', await page.locator('.lb-form-error').first().innerText());

  const result = await page.evaluate(async () => {
    const b64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append('file', new File([arr], 'probe.png', { type: 'image/png' }));
    fd.append('kind', 'memory_cards');
    const r = await fetch('/api/upload/photo', { method: 'POST', body: fd });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return { status: r.status, body };
  });
  console.log('\nupload status:', result.status);
  console.log('upload body:', JSON.stringify(result.body).slice(0, 500));

  const publicUrl = result.body?.publicUrl;
  if (publicUrl) {
    const rd = await fetch(publicUrl);
    const buf = Buffer.from(await rd.arrayBuffer());
    console.log('\nanon read:', rd.status, rd.headers.get('content-type'), buf.length, 'bytes');
    if (rd.status !== 200) console.log('  body:', buf.toString('utf8').slice(0, 200));

    // Remove the object this probe uploaded, so a run leaves no orphans.
    const marker = '/object/public/lovorithm-media/';
    const path = publicUrl.includes(marker)
      ? decodeURIComponent(publicUrl.slice(publicUrl.indexOf(marker) + marker.length))
      : null;
    if (path) {
      const del = await fetch(`${SUPA}/storage/v1/object/lovorithm-media/${path}`, {
        method: 'DELETE',
        headers: { apikey: SK, Authorization: `Bearer ${SK}` },
      });
      console.log('cleanup object:', del.status);
    }
  }
} finally {
  await browser.close();
  const del = await fetch(`${SUPA}/auth/v1/admin/users/${createdBody.id}`, {
    method: 'DELETE',
    headers: { apikey: SK, Authorization: `Bearer ${SK}` },
  });
  console.log('\ncleanup delete user:', del.status);
}
