// Readiness gate for the Lovorithm launch-readiness loop (OOP-5816).
//
// This is the objective gate for the "Paperclip: Lovorithm Launch-Readiness
// Loop" routine. The gate's exit code IS the verdict: 0 = ready to serve,
// 1 = one or more thresholds breached (the loop must pick the top gap and
// ship a fix), 2 = the probe itself could not run (no network / no Chrome).
//
// Usage:
//   node scripts/readiness-gate.mjs
//   AUDIT_BASE=https://staging.example.com node scripts/readiness-gate.mjs
//
// Thresholds (override with env if needed):
//   GATE_PERF_MIN   default 95   Lighthouse performance score, per route
//   GATE_A11Y_MIN   default 98   Lighthouse accessibility score, per route
//   GATE_ROUTES_MIN default 200  lowest acceptable status for a critical route
//   GATE_ROUTES_MAX default 399  highest acceptable status for a critical route
//   GATE_ROUTE_MAX_MS default 4000  max time to serve a critical route in full
//   GATE_CATALOG_MIN default 1   gifts the public catalog must serve
//   GATE_LH_SAMPLES default 3    Lighthouse samples per route; the MEDIAN is
//                                 scored. One sample is a coin flip against a
//                                 95 threshold (see the Lighthouse probe below).

import { probeRoute } from './lib/http-probe.mjs';

const BASE = process.env.AUDIT_BASE ?? 'https://lovorithm.vercel.app';
const PERF_MIN = Number(process.env.GATE_PERF_MIN ?? 95);
const A11Y_MIN = Number(process.env.GATE_A11Y_MIN ?? 98);
const ROUTES_MIN = Number(process.env.GATE_ROUTES_MIN ?? 200);
// A critical route must SERVE. The upper bound is what makes a 404 or a
// 500 on a critical route a failure — the floor alone (`status < 200`)
// let a broken route pass as healthy (OOP-6701).
const ROUTES_MAX = Number(process.env.GATE_ROUTES_MAX ?? 399);
const ROUTE_MAX_MS = Number(process.env.GATE_ROUTE_MAX_MS ?? 4000);
const CATALOG_MIN = Number(process.env.GATE_CATALOG_MIN ?? 1);

// Critical routes: a 5xx/404 on any of these is a P1 for "ready to serve".
const ROUTES = [
  '/',
  '/browse',
  '/g/demo',
  '/status',
  '/support',
  '/privacy',
  '/terms',
  '/login',
  '/signup',
];

// Lighthouse-scored routes (the heavy ones). Keep this list short —
// Lighthouse is the slowest part of the gate.
const LIGHTHOUSE_ROUTES = ['/', '/g/demo', '/browse'];

const failures = [];
const notes = [];

/**
 * A stable, machine-readable id for a gap.
 *
 * The loop files issues against gaps, and a gap that recurs every day
 * must map to the SAME id every day — otherwise the loop files a new
 * issue for a cause that is already tracked. `scripts/loop-triage.mjs`
 * matches these ids against the open issues to decide "already tracked"
 * vs "new gap".
 */
function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fail(scope, msg, key) {
  const id = slug(key ?? scope);
  // A gap id is the tracking key the loop matches issues against, so one
  // id must mean one gap. Two probes can see the same missing var (the
  // webhook route and /api/readiness); report it once.
  if (failures.some((f) => f.id === id)) {
    console.log(`FAIL  ${id}: ${msg} (already reported)`);
    return;
  }
  failures.push({ id, scope, message: msg });
  console.log(`FAIL  ${id}: ${msg}`);
}
function pass(scope, msg) {
  console.log(`ok    ${scope}: ${msg}`);
}

// ---------------------------------------------------------------- HTTP probe
// OOP-5816: the response must be served IN FULL within GATE_ROUTE_MAX_MS.
//
// A status code alone does not mean the page is usable. `/browse` was
// answering 200 with its first byte in 350ms and its markup 6.5 seconds
// later — the server held the whole body while a database read timed
// out, so the visitor saw a blank white page. Reading the body here
// (rather than just the headers) is what makes that visible: a route
// that streams slowly fails the budget instead of passing as 200.
//
// The probe itself lives in scripts/lib/http-probe.mjs so its one
// interesting decision — cold boot vs genuinely slow route — is unit
// tested (OOP-6701).
let httpResults = [];
for (const path of ROUTES) {
  const probe = await probeRoute(path, {
    base: BASE,
    routesMin: ROUTES_MIN,
    routesMax: ROUTES_MAX,
    routeMaxMs: ROUTE_MAX_MS,
  });
  httpResults.push({
    path,
    status: probe.status,
    ms: probe.ms,
    firstMs: probe.firstMs,
  });
  if (probe.verdict === 'status') {
    fail('http', probe.message, `http-${path}-status`);
  } else if (probe.verdict === 'slow') {
    fail('http', probe.message, `http-${path}-slow`);
  } else if (probe.verdict === 'unreachable') {
    fail('http', probe.message, `http-${path}-unreachable`);
  } else if (probe.verdict === 'cold') {
    // The first hit paid the cold boot, not the route: a note, not a gap.
    // The cost stays visible in the run summary without failing a gate the
    // loop can never converge on (OOP-6701).
    notes.push(probe.message);
    pass('http', `${path} ${probe.status} in ${probe.ms}ms (cold first hit ${probe.firstMs}ms)`);
  } else {
    pass('http', `${path} ${probe.status} in ${probe.ms}ms`);
  }
}

// ------------------------------------------------------------ Data-layer probe
// OOP-6154: HTTP status codes are not readiness. When the Supabase project
// host stopped resolving, /browse and /api/catalog/feed still answered 200
// with an empty catalog, so a status-code-only gate called a site with no
// data layer "ready to serve". These two checks are the difference between
// "the pages load" and "the site can actually serve a user".
//
//   1. /status must report data-status-state="operational" — that marker is
//      only emitted when the live incident read SUCCEEDED. A dead data layer
//      renders data-status-state="unknown".
//   2. /api/catalog/feed must serve at least GATE_CATALOG_MIN gifts — an
//      empty catalog means nothing is published and nothing is for sale.
try {
  const res = await fetch(`${BASE}/status`, { redirect: 'manual' });
  const html = await res.text();
  const state = html.match(/data-status-state="([a-z]+)"/)?.[1];
  if (!state) {
    fail(
      'data',
      '/status did not emit data-status-state — the page is not reporting whether its live read succeeded',
      'data-status-missing',
    );
  } else if (state === 'unknown') {
    fail(
      'data',
      '/status reports data-status-state="unknown" — the live incident read FAILED, so the data layer is not serving',
      'data-status-unknown',
    );
  } else if (state !== 'operational') {
    fail(
      'data',
      `/status reports data-status-state="${state}" (expected "operational") — the live read succeeded but the site is not fully operational`,
      `data-status-${state}`,
    );
  } else {
    pass('data', '/status live read → operational');
  }
} catch (err) {
  fail('data', `/status unreadable — ${err.message}`, 'data-status-unreadable');
}

try {
  const res = await fetch(`${BASE}/api/catalog/feed`, { redirect: 'manual' });
  const body = await res.json().catch(() => null);
  const n = Array.isArray(body?.gifts) ? body.gifts.length : -1;
  if (!res.ok) {
    fail('data', `/api/catalog/feed returned ${res.status}`, 'data-catalog-error');
  } else if (n < 0) {
    fail('data', '/api/catalog/feed did not return a gifts array', 'data-catalog-malformed');
  } else if (n < CATALOG_MIN) {
    fail(
      'data',
      `/api/catalog/feed served ${n} gifts (expected >= ${CATALOG_MIN}) — the catalog is empty`,
      'data-catalog-empty',
    );
  } else {
    pass('data', `/api/catalog/feed served ${n} gifts`);
  }
} catch (err) {
  fail('data', `/api/catalog/feed unreadable — ${err.message}`, 'data-catalog-unreadable');
}

// ------------------------------------------------------------- Money-path probe
// A marketplace that cannot take a payment is not ready to serve, and
// the failure mode is the worst kind: the customer pays and nothing is
// fulfilled. The Stripe webhook is where a paid order is turned into a
// gift, so it is where "can we take money" is decided.
//
// This checks the CONFIGURATION, not a live charge. A POST with a bogus
// signature must come back 400 ("signature verification failed") when
// both Stripe vars are present, and the route now names which one is
// missing when they are not:
//
//   500 { error: 'webhook secret not configured' }  → STRIPE_WEBHOOK_SECRET
//   503 { error: 'stripe secret key not configured' } → STRIPE_SECRET_KEY
//
// The 503 branch is load-bearing (OOP-6168). Without it a missing
// STRIPE_SECRET_KEY made `getStripe()` throw inside the SDK call, the
// route caught it and answered 400 "signature verification failed" —
// indistinguishable from a genuine signature rejection. The gate read
// that 400 as "the money path is configured" while checkout could not
// create a single PaymentIntent. A green gate on a dead money path is
// worse than a red one, because it silences the alarm.
try {
  const res = await fetch(`${BASE}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': 't=1,v1=readiness-gate-probe',
    },
    body: JSON.stringify({ type: 'checkout.session.completed' }),
  });
  const body = await res.json().catch(() => ({}));
  const errText = typeof body?.error === 'string' ? body.error : '';

  if (res.status === 400) {
    pass('money', 'stripe webhook is configured (bogus signature rejected as expected)');
  } else if (errText === 'webhook secret not configured') {
    fail(
      'money',
      'STRIPE_WEBHOOK_SECRET is missing from the deployed env — a paid order could be taken but never fulfilled',
      'stripe-webhook-secret-missing',
    );
  } else if (errText === 'stripe secret key not configured') {
    fail(
      'money',
      'STRIPE_SECRET_KEY is missing from the deployed env — the webhook cannot verify signatures and checkout cannot create a payment',
      'stripe-secret-key-missing',
    );
  } else if (res.status >= 500) {
    fail(
      'money',
      `/api/stripe/webhook returned ${res.status} (${errText || 'no error detail'}) — the money path is broken in a way the readiness probe cannot name`,
      'stripe-money-path-error',
    );
  } else {
    fail(
      'money',
      `/api/stripe/webhook returned ${res.status} (expected 400 for a bogus signature)`,
      'stripe-webhook-unexpected',
    );
  }
} catch (err) {
  fail('money', `/api/stripe/webhook unreachable — ${err.message}`, 'stripe-webhook-unreachable');
}

// --------------------------------------------------------------- Env-var probe
// The money probe can only see the Stripe side. The Resend side was
// invisible to the gate: with no RESEND_API_KEY, every email — the
// waitlist autoresponder, the purchase receipt — is a silent no-op while
// the site renders perfectly and every route returns 200. A deployment
// in that state passed the gate.
//
// `/api/readiness` reports the NAMES of the missing required vars (never
// values). Each name maps to a stable gap id so the loop files one
// issue per missing var and this tracker keeps owning them.
const REQUIRED_ENV_IDS = {
  STRIPE_SECRET_KEY: 'stripe-secret-key-missing',
  STRIPE_WEBHOOK_SECRET: 'stripe-webhook-secret-missing',
  RESEND_API_KEY: 'resend-api-key-missing',
  RESEND_FROM: 'resend-from-missing',
};
try {
  const res = await fetch(`${BASE}/api/readiness`, { redirect: 'manual' });
  const body = await res.json().catch(() => null);
  const missing = Array.isArray(body?.missing) ? body.missing : null;

  if (!res.ok) {
    fail('env', `/api/readiness returned ${res.status}`, 'readiness-probe-error');
  } else if (!missing) {
    fail(
      'env',
      '/api/readiness did not return a missing[] array — env readiness is invisible to the gate',
      'readiness-probe-malformed',
    );
  } else if (missing.length === 0) {
    pass('env', 'every required production env var is present');
  } else {
    for (const name of missing) {
      const id = REQUIRED_ENV_IDS[name] ?? `env-${slug(name)}-missing`;
      fail(
        'env',
        `${name} is missing from the deployed env`,
        id,
      );
    }
  }
} catch (err) {
  fail('env', `/api/readiness unreachable — ${err.message}`, 'readiness-probe-unreachable');
}

// --------------------------------------------------------------- Media probe
//
// A gift is photos. For the whole life of the project NO photo, video,
// audio or avatar had ever been uploaded — and the gate reported the site
// as healthy the whole time, because a broken upload path is invisible to
// a page load and to an HTTP status code.
//
// Two independent defects were hiding behind that green gate (both fixed
// 2026-10-28, OOP-5816):
//
//   1. the upload routes wrote with the user-scoped client while the
//      `storage.objects` RLS policies had never been applied to the live
//      project → every upload died with "new row violates row-level
//      security policy";
//   2. the app hands out `getPublicUrl()` URLs, and Storage's public
//      endpoint only serves an object from a PUBLIC bucket — the bucket
//      was private, so even a stored object rendered as a broken image.
//
// `/api/readiness/media` performs the roundtrip the product depends on:
// write through the app's own storage helper, fetch it back with no auth
// header (what the recipient's browser does), delete it again.
try {
  const res = await fetch(`${BASE}/api/readiness/media`, { redirect: 'manual' });
  const body = await res.json().catch(() => null);

  if (res.status === 200 && body?.ok) {
    pass('media', `media roundtrip ok (${body?.read?.bytes ?? '?'} bytes read back)`);
  } else if (body?.write && body?.write !== 'ok') {
    fail(
      'media',
      `the media bucket rejected a write — ${body.error ?? 'unknown error'}. Uploads are broken: no gift can carry a photo`,
      'media-upload-broken',
    );
  } else if (body?.read && body.read.status !== 200) {
    fail(
      'media',
      `media was written but the public read returned ${body.read.status} — recipients would see broken images`,
      'media-read-broken',
    );
  } else {
    fail(
      'media',
      `/api/readiness/media returned ${res.status}${body?.error ? ` — ${body.error}` : ''}`,
      'media-path-broken',
    );
  }
} catch (err) {
  fail('media', `/api/readiness/media unreachable — ${err.message}`, 'media-probe-unreachable');
}

// ------------------------------------------------------------ Lighthouse probe
//
// Lighthouse is a noisy instrument, and the gate's verdict is a threshold
// comparison against it. OOP-6548 measured the UNCHANGED homepage ten times
// and got perf = 81, 87, 93, 94, 96, 97, 97, 99, 99, 99 — a 18-point spread
// around a 95 threshold. The spread tracks host CPU contention (total
// blocking time swung 0ms → 450ms with the machine loaded), not the site:
// the same page measured perf=99 unthrottled.
//
// A single sample against that threshold is a coin flip, so the loop used to
// fire on measurement noise and file a "regression" issue against an
// unchanged page. Sample each route N times and take the median — the
// standard CI practice for Lighthouse. The threshold, the routes and the
// exit codes are unchanged; only the estimator gets less noisy.
const LIGHTHOUSE_SAMPLES = Math.max(1, Number(process.env.GATE_LH_SAMPLES ?? 3));

/** Median of a numeric sample. Even-length medians average the two middles. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

let lighthouseResults = [];
let lighthouseRan = false;
try {
  const { default: lighthouse } = await import('lighthouse');
  // chrome-launcher is CJS: its `launch` lives on the namespace object, not
  // on `.default`. Reading `.default.launch` threw "Cannot read properties
  // of undefined" and silently skipped the whole Lighthouse pass — which
  // made the gate report PASS without ever measuring perf or a11y.
  const chromeLauncher = await import('chrome-launcher');
  const launch = chromeLauncher.launch ?? chromeLauncher.default?.launch;
  if (typeof launch !== 'function') {
    throw new Error('chrome-launcher exposes no launch() function');
  }
  const chrome = await launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  try {
    for (const path of LIGHTHOUSE_ROUTES) {
      const perfSamples = [];
      const a11ySamples = [];
      let auditError = null;
      for (let i = 0; i < LIGHTHOUSE_SAMPLES; i++) {
        try {
          const r = await lighthouse(`${BASE}${path}`, {
            port: chrome.port,
            output: 'json',
            logLevel: 'error',
            onlyCategories: ['performance', 'accessibility'],
          });
          const c = r.lhr.categories;
          perfSamples.push(Math.round(c.performance.score * 100));
          a11ySamples.push(Math.round(c.accessibility.score * 100));
        } catch (err) {
          auditError = err;
          break;
        }
      }
      if (auditError || perfSamples.length === 0) {
        lighthouseResults.push({ path, perf: null, a11y: null, samples: perfSamples.length });
        fail(
          'lighthouse',
          `${path} audit failed — ${String(auditError?.message ?? 'no samples collected').slice(0, 120)}`,
          `lighthouse-${path}-audit`,
        );
        continue;
      }
      const perf = median(perfSamples);
      const a11y = median(a11ySamples);
      const spread = `samples ${perfSamples.join(',')}`;
      lighthouseResults.push({ path, perf, a11y, samples: perfSamples.length, perfSamples, a11ySamples });
      if (perf < PERF_MIN) fail('lighthouse', `${path} perf=${perf} (< ${PERF_MIN}) — ${spread}`, `lighthouse-${path}-perf`);
      else pass('lighthouse', `${path} perf=${perf} — ${spread}`);
      if (a11y < A11Y_MIN) fail('lighthouse', `${path} a11y=${a11y} (< ${A11Y_MIN}) — ${spread}`, `lighthouse-${path}-a11y`);
      else pass('lighthouse', `${path} a11y=${a11y} — ${spread}`);
    }
    lighthouseRan = lighthouseResults.length > 0;
  } finally {
    await chrome.kill();
  }
} catch (err) {
  console.log(`note  lighthouse unavailable: ${String(err.message).slice(0, 160)}`);
  notes.push('lighthouse skipped');
}

// --------------------------------------------------------------- OG metadata
try {
  const html = await (await fetch(`${BASE}/`)).text();
  for (const tag of ['og:title', 'og:description', 'twitter:card']) {
    if (!html.includes(tag)) fail('og', `missing ${tag} on /`, `og-missing-${tag}`);
  }
  // OOP-6155 — the static card image ships now (public/og.png), so a
  // missing og:image is a failure rather than a warning. The tag is also
  // resolved: an og:image that 404s (or is not a PNG) fails the gate.
  if (!html.includes('og:image')) {
    fail('og', 'missing og:image on /', 'og-missing-og-image');
  } else {
    const tag = html.match(/<meta[^>]*property="og:image"[^>]*>/)?.[0];
    const src = tag?.match(/content="([^"]+)"/)?.[1];
    if (!src) {
      fail('og', 'og:image tag on / has no content URL', 'og-image-no-url');
    } else {
      try {
        const img = await fetch(src, { redirect: 'follow' });
        const ct = img.headers.get('content-type') ?? '';
        if (!img.ok) fail('og', `og:image ${src} returned ${img.status}`, 'og-image-not-ok');
        else if (!ct.startsWith('image/png')) fail('og', `og:image ${src} is ${ct} (expected image/png)`, 'og-image-not-png');
        else pass('og', `og:image ${src} ${img.status} ${ct}`);
      } catch (err) {
        fail('og', `og:image ${src} unreachable — ${err.message}`, 'og-image-unreachable');
      }
    }
  }
  if (failures.filter((f) => f.scope === 'og').length === 0) pass('og', 'og:/twitter: tags present');
} catch (err) {
  fail('og', `could not fetch / — ${err.message}`, 'og-unfetchable');
}

// ------------------------------------------------------------------- summary
console.log('\n--- readiness-gate summary ---');
console.log(`base=${BASE}`);
console.log(`routes=${httpResults.length} lighthouse=${lighthouseResults.length}`);
console.log(JSON.stringify({ http: httpResults, lighthouse: lighthouseResults }, null, 2));
console.log(
  JSON.stringify(
    { data: failures.filter((f) => f.scope === 'data').map((f) => f.message) },
    null,
    2,
  ),
);

// A probe that could not measure perf/a11y must not report PASS. Exit 2
// means "the probe itself did not run" — the loop files an issue instead of
// claiming the site is ready.
const verdict = !lighthouseRan ? 'INCOMPLETE' : failures.length === 0 ? 'PASS' : 'FAIL';

// Machine-readable output for the loop's triage step
// (scripts/loop-triage.mjs): the gap ids are what the loop matches
// against open issues, so a gap that recurs maps to the same issue
// instead of filing a new one every day.
if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        base: BASE,
        verdict,
        exitCode: verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2,
        gaps: failures.map((f) => ({ id: f.id, scope: f.scope, message: f.message })),
        http: httpResults,
        lighthouse: lighthouseResults,
        notes,
      },
      null,
      2,
    ),
  );
}

// `--json-file <path>` writes the same payload to a file instead of
// stdout, so a caller can consume it without parsing the log.
const jsonFileIndex = process.argv.indexOf('--json-file');
if (jsonFileIndex !== -1) {
  const path = process.argv[jsonFileIndex + 1];
  if (!path) {
    console.error('--json-file needs a path');
    process.exit(2);
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    path,
    JSON.stringify(
      {
        base: BASE,
        verdict,
        exitCode: verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 2,
        gaps: failures.map((f) => ({ id: f.id, scope: f.scope, message: f.message })),
        http: httpResults,
        lighthouse: lighthouseResults,
        notes,
      },
      null,
      2,
    ),
  );
}

// A probe that could not measure perf/a11y must not report PASS. Exit 2
// means "the probe itself did not run" — the loop files an issue instead of
// claiming the site is ready.
if (!lighthouseRan) {
  console.log('\nRESULT: INCOMPLETE — the Lighthouse pass did not run, so the probe cannot rule out perf/a11y regressions.');
  console.log('notes: ' + (notes.join(', ') || 'none'));
  process.exit(2);
}

if (failures.length === 0) {
  console.log(`\nRESULT: PASS — ${BASE} is ready to serve.`);
  process.exit(0);
}

console.log(`\nRESULT: FAIL — ${failures.length} gap(s):`);
for (const f of failures) console.log(`  - ${f.id}: ${f.message}`);
if (notes.length) console.log(`notes: ${notes.join(', ')}`);
process.exit(1);
