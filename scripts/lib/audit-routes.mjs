// Shared route table + session helpers for the browser audits (OOP-6735).
//
// ONE list of shipped routes, used by BOTH scripts/a11y-audit.mjs and
// scripts/mobile-audit.mjs. Before this module each script carried its
// own list, the two drifted, and the a11y one audited 10 of the ~32
// pages the site actually ships — including /support, which is exactly
// where the contrast violation that OOP-6733 fixed was hiding.
//
// Dynamic segments are resolved at RUN time rather than hard-coded. The
// catalog feed and the shares table are the live sources of a real gift
// id, a real creator handle and a real share token. A hard-coded id rots
// the day the seed is re-run, and a route that 404s is a route nobody
// actually audited.
//
// The public URL form is locale-less on purpose: the app tree is
// src/app/[locale]/… but src/proxy.ts rewrites the locale-less public
// URL to the internal /{locale}/… path, so these are the paths a
// visitor (and a recipient link) actually uses.

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Every page the site ships.
 *
 * `auth: true` means the route redirects an anonymous visitor to
 * /login. Those routes are only measured when the audit can sign in; an
 * unsigned audit reports them as "not measured" rather than pretending
 * the login page is the builder.
 */
export const AUDIT_ROUTES = [
  // --- public, no session needed -------------------------------------
  { path: '/', label: 'landing' },
  { path: '/browse', label: 'browse' },
  { path: '/gifts', label: 'gift-guides' },
  { path: '/gifts/birthday-ideas', label: 'gift-guide-detail' },
  { path: '/g/demo', label: 'recipient-demo' },
  { path: '/g/:token', label: 'recipient-share' },
  { path: '/g/:token/open', label: 'recipient-open' },
  { path: '/l/:giftId', label: 'listing' },
  { path: '/u/:handle', label: 'profile' },
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/signup/check-email', label: 'signup-check-email' },
  { path: '/support', label: 'support' },
  { path: '/status', label: 'status' },
  { path: '/privacy', label: 'privacy' },
  { path: '/terms', label: 'terms' },
  { path: '/checkout/cancel', label: 'checkout-cancel' },
  { path: '/checkout/success', label: 'checkout-success' },
  // A URL that matches no route. Next serves its own fallback document
  // for it, which is not the app's page — see the html-has-lang entry in
  // KNOWN_EXCEPTIONS (scripts/a11y-audit.mjs).
  { path: '/random-404', label: 'not-found', notFound: true },

  // --- signed-in only (they redirect an anonymous visitor to /login) --
  { path: '/create', label: 'create-picker', auth: true },
  { path: '/create/quiz', label: 'builder-quiz', auth: true },
  { path: '/create/memory-cards', label: 'builder-memory-cards', auth: true },
  { path: '/create/animated-letter', label: 'builder-animated-letter', auth: true },
  { path: '/create/dragdrop-puzzle', label: 'builder-dragdrop-puzzle', auth: true },
  { path: '/create/multimedia-collage', label: 'builder-multimedia-collage', auth: true },
  { path: '/create/code', label: 'builder-code', auth: true },
  { path: '/create/:giftId/finish', label: 'create-finish', auth: true },
  { path: '/checkout/:giftId', label: 'checkout', auth: true },
  { path: '/settings', label: 'settings', auth: true },
  { path: '/purchases', label: 'purchases', auth: true },
  { path: '/u/me', label: 'profile-me', auth: true },
  { path: '/u/:handle/edit', label: 'profile-edit', auth: true },
  { path: '/onboarding', label: 'onboarding', auth: true },
];

/**
 * Parse the repo's .env.local, if it is there.
 *
 * The file holds the Supabase URL and the secret key. It is NOT in git
 * (it is gitignored), so a CI checkout or a clean clone has no
 * credentials — the audits then run unsigned and say so, rather than
 * silently measuring the login page instead of the builders.
 */
export function readEnvLocal() {
  try {
    const raw = readFileSync(new URL('../../.env.local', import.meta.url).pathname, 'utf8');
    return raw
      .split('\n')
      .filter((l) => l && !l.startsWith('#'))
      .reduce((acc, line) => {
        const [k, ...v] = line.split('=');
        acc[k.trim()] = v.join('=').trim();
        return acc;
      }, {});
  } catch {
    return {};
  }
}

/**
 * Launch the browser the audits use.
 *
 * Playwright's BUNDLED Chromium is not installed on this host (there is
 * no ms-playwright cache), so `chromium.launch()` died with
 * "Executable doesn't exist at …/chrome-headless-shell" and BOTH audits
 * crashed before they measured anything (OOP-6735). The system Chrome
 * works. `PW_CHANNEL` overrides it — CI installs Playwright's own
 * Chromium and sets `PW_CHANNEL=chromium`, this host uses `chrome`.
 *
 * One helper, so the fix cannot drift between the two scripts again.
 */
export async function launchBrowser() {
  const channel = process.env.PW_CHANNEL ?? 'chrome';
  return chromium.launch({ channel });
}

/**
 * Resolve the dynamic segments to real, live ids.
 *
 * @returns {Promise<{giftId: string, handle: string, token: string}>}
 */
export async function resolveRouteParams({ base, env }) {
  const fallback = {
    giftId: '00000000-0000-0000-0000-000000000000',
    handle: 'arjun',
    token: 'demo',
  };

  let giftId = fallback.giftId;
  let handle = fallback.handle;

  try {
    const res = await fetch(`${base}/api/catalog/feed`, { redirect: 'manual' });
    const body = await res.json().catch(() => null);
    const gift = body?.gifts?.[0];
    if (gift?.id) giftId = gift.id;
    if (gift?.owner?.handle) handle = gift.owner.handle;
  } catch {
    // Keep the fallbacks — a route that 404s is still audited, it just
    // audits the not-found page. The run summary says which ids were used.
  }

  // A real share token: the shares table is readable with the publishable
  // key (the `shares_select_public_by_token` policy), so the audit can
  // measure the recipient page of an actual gift.
  let token = fallback.token;
  const supa = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_SECRET_KEY;
  if (supa && key) {
    try {
      const res = await fetch(`${supa}/rest/v1/shares?select=token&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      const rows = await res.json().catch(() => null);
      if (Array.isArray(rows) && rows[0]?.token) token = rows[0].token;
    } catch {
      // Fall back to the seeded demo token.
    }
  }

  return { giftId, handle, token };
}

/** Substitute the resolved ids into the route table. */
export function expandRoutes(routes, params) {
  return routes.map((route) => ({
    ...route,
    path: route.path
      .replace(':giftId', params.giftId)
      .replace(':handle', params.handle)
      .replace(':token', params.token),
  }));
}

/**
 * Create a throwaway user, sign in through the real /login form, and
 * hand back a cleanup that deletes the user again.
 *
 * The sign-in is a real UI sign-in (not a token injection) because the
 * app reads the session from the Supabase auth COOKIE — a bearer token
 * gets 401 on the upload routes (see scripts/media-e2e.mjs).
 *
 * Returns null when there are no credentials — a CI checkout has no
 * .env.local, and an unsigned audit is honest about what it could not
 * measure instead of measuring /login and calling it a builder.
 *
 * @returns {Promise<{cleanup: () => Promise<void>} | null>}
 */
export async function signInAsAuditUser({ page, base, env }) {
  const supa = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!supa || !secretKey) return null;

  const email = `audit-a11y-${Date.now()}@example.com`;
  const password = `pw-${Math.random().toString(36).slice(2)}-A1`;

  const created = await fetch(`${supa}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createdBody = await created.json().catch(() => null);
  if (created.status >= 300) {
    throw new Error(`could not create the throwaway audit user: HTTP ${created.status}`);
  }
  const userId = createdBody?.id;

  const cleanup = async () => {
    if (!userId) return;
    try {
      await fetch(`${supa}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
      });
    } catch {
      // A leftover throwaway user is not worth failing the audit over.
    }
  };

  try {
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForTimeout(1500);
  } catch (err) {
    await cleanup();
    throw err;
  }

  return { cleanup };
}
