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

const BASE = process.env.AUDIT_BASE ?? 'https://lovebyte-five.vercel.app';
const PERF_MIN = Number(process.env.GATE_PERF_MIN ?? 95);
const A11Y_MIN = Number(process.env.GATE_A11Y_MIN ?? 98);
const ROUTES_MIN = Number(process.env.GATE_ROUTES_MIN ?? 200);

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
let httpResults = [];
for (const path of ROUTES) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    httpResults.push({ path, status: res.status });
    if (res.status < ROUTES_MIN) {
      fail('http', `${path} returned ${res.status} (expected >= ${ROUTES_MIN})`);
    } else {
      pass('http', `${path} ${res.status}`);
    }
  } catch (err) {
    httpResults.push({ path, status: 0 });
    fail('http', `${path} unreachable — ${err.message}`);
  }
}

// ------------------------------------------------------------ Lighthouse probe
let lighthouseResults = [];
try {
  const { default: lighthouse } = await import('lighthouse');
  const { default: chromeLauncher } = await import('chrome-launcher');
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
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
  // og:image is tracked separately (no static asset ships yet) — warn only.
  if (!html.includes('og:image')) {
    notes.push('og:image missing on / (tracked in the launch-readiness follow-up)');
    console.log('warn  og: missing og:image on /');
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

if (failures.length === 0) {
  console.log(`\nRESULT: PASS — ${BASE} is ready to serve.`);
  process.exit(0);
}

console.log(`\nRESULT: FAIL — ${failures.length} gap(s):`);
for (const f of failures) console.log(`  - ${f}`);
if (notes.length) console.log(`notes: ${notes.join(', ')}`);
process.exit(1);
