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
//   GATE_ROUTES_MIN default 200  required HTTP status for every critical route
//   GATE_ROUTE_MAX_MS default 3000  max time to serve a critical route in full
//   GATE_CATALOG_MIN default 1   gifts the public catalog must serve

const BASE = process.env.AUDIT_BASE ?? 'https://lovebyte-five.vercel.app';
const PERF_MIN = Number(process.env.GATE_PERF_MIN ?? 95);
const A11Y_MIN = Number(process.env.GATE_A11Y_MIN ?? 98);
const ROUTES_MIN = Number(process.env.GATE_ROUTES_MIN ?? 200);
const ROUTE_MAX_MS = Number(process.env.GATE_ROUTE_MAX_MS ?? 3000);
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

function fail(scope, msg) {
  failures.push(`${scope}: ${msg}`);
  console.log(`FAIL  ${scope}: ${msg}`);
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
let httpResults = [];
for (const path of ROUTES) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    await res.text();
    const ms = Date.now() - started;
    httpResults.push({ path, status: res.status, ms });
    if (res.status < ROUTES_MIN) {
      fail('http', `${path} returned ${res.status} (expected >= ${ROUTES_MIN})`);
    } else if (ms > ROUTE_MAX_MS) {
      fail(
        'http',
        `${path} served in ${ms}ms (expected <= ${ROUTE_MAX_MS}ms) — too slow to serve`,
      );
    } else {
      pass('http', `${path} ${res.status} in ${ms}ms`);
    }
  } catch (err) {
    httpResults.push({ path, status: 0, ms: Date.now() - started });
    fail('http', `${path} unreachable — ${err.message}`);
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
    );
  } else if (state === 'unknown') {
    fail(
      'data',
      '/status reports data-status-state="unknown" — the live incident read FAILED, so the data layer is not serving',
    );
  } else if (state !== 'operational') {
    fail(
      'data',
      `/status reports data-status-state="${state}" (expected "operational") — the live read succeeded but the site is not fully operational`,
    );
  } else {
    pass('data', '/status live read → operational');
  }
} catch (err) {
  fail('data', `/status unreadable — ${err.message}`);
}

try {
  const res = await fetch(`${BASE}/api/catalog/feed`, { redirect: 'manual' });
  const body = await res.json().catch(() => null);
  const n = Array.isArray(body?.gifts) ? body.gifts.length : -1;
  if (!res.ok) {
    fail('data', `/api/catalog/feed returned ${res.status}`);
  } else if (n < 0) {
    fail('data', '/api/catalog/feed did not return a gifts array');
  } else if (n < CATALOG_MIN) {
    fail(
      'data',
      `/api/catalog/feed served ${n} gifts (expected >= ${CATALOG_MIN}) — the catalog is empty`,
    );
  } else {
    pass('data', `/api/catalog/feed served ${n} gifts`);
  }
} catch (err) {
  fail('data', `/api/catalog/feed unreadable — ${err.message}`);
}

// ------------------------------------------------------------ Lighthouse probe
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
      try {
        const r = await lighthouse(`${BASE}${path}`, {
          port: chrome.port,
          output: 'json',
          logLevel: 'error',
          onlyCategories: ['performance', 'accessibility'],
        });
        const c = r.lhr.categories;
        const perf = Math.round(c.performance.score * 100);
        const a11y = Math.round(c.accessibility.score * 100);
        lighthouseResults.push({ path, perf, a11y });
        if (perf < PERF_MIN) fail('lighthouse', `${path} perf=${perf} (< ${PERF_MIN})`);
        else pass('lighthouse', `${path} perf=${perf}`);
        if (a11y < A11Y_MIN) fail('lighthouse', `${path} a11y=${a11y} (< ${A11Y_MIN})`);
        else pass('lighthouse', `${path} a11y=${a11y}`);
      } catch (err) {
        lighthouseResults.push({ path, perf: null, a11y: null });
        fail('lighthouse', `${path} audit failed — ${String(err.message).slice(0, 120)}`);
      }
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
    if (!html.includes(tag)) fail('og', `missing ${tag} on /`);
  }
  // OOP-6155 — the static card image ships now (public/og.png), so a
  // missing og:image is a failure rather than a warning. The tag is also
  // resolved: an og:image that 404s (or is not a PNG) fails the gate.
  if (!html.includes('og:image')) {
    fail('og', 'missing og:image on /');
  } else {
    const tag = html.match(/<meta[^>]*property="og:image"[^>]*>/)?.[0];
    const src = tag?.match(/content="([^"]+)"/)?.[1];
    if (!src) {
      fail('og', 'og:image tag on / has no content URL');
    } else {
      try {
        const img = await fetch(src, { redirect: 'follow' });
        const ct = img.headers.get('content-type') ?? '';
        if (!img.ok) fail('og', `og:image ${src} returned ${img.status}`);
        else if (!ct.startsWith('image/png')) fail('og', `og:image ${src} is ${ct} (expected image/png)`);
        else pass('og', `og:image ${src} ${img.status} ${ct}`);
      } catch (err) {
        fail('og', `og:image ${src} unreachable — ${err.message}`);
      }
    }
  }
  if (failures.filter((f) => f.startsWith('og:')).length === 0) pass('og', 'og:/twitter: tags present');
} catch (err) {
  fail('og', `could not fetch / — ${err.message}`);
}

// ------------------------------------------------------------------- summary
console.log('\n--- readiness-gate summary ---');
console.log(`base=${BASE}`);
console.log(`routes=${httpResults.length} lighthouse=${lighthouseResults.length}`);
console.log(JSON.stringify({ http: httpResults, lighthouse: lighthouseResults }, null, 2));
console.log(
  JSON.stringify(
    { data: failures.filter((f) => f.startsWith('data:')).map((f) => f.slice(5)) },
    null,
    2,
  ),
);

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
for (const f of failures) console.log(`  - ${f}`);
if (notes.length) console.log(`notes: ${notes.join(', ')}`);
process.exit(1);
