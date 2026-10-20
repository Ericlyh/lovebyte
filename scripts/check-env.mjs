#!/usr/bin/env node
/**
 * Env audit for the Lovorithm production deploy (OOP-6168).
 *
 * `docs/launch-checklist.md` §1 lists the vars every production deploy
 * needs, in two places: `.env.local` (local dev) and the Vercel
 * production environment. Until now that list was a manual check, and
 * the manual check failed quietly — the production env was missing all
 * four Stripe / Resend vars for weeks while every route returned 200.
 *
 * This script is that check, automated. It reports PRESENCE only: no
 * value is ever printed, and no value is written anywhere.
 *
 *   node scripts/check-env.mjs
 *
 * Requires `VERCELTOKEN` in the environment to read the Vercel project
 * env. Without it the script still audits `.env.local` and says so.
 *
 * Exit code: 0 = every required var is present in production,
 *             1 = at least one is missing.
 */

const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? 'prj_C9TIIEni96mFmt7WIF1gfh4Nq8dj';
const VERCEL_TOKEN = process.env.VERCELTOKEN ?? process.env.VERCEL_API_TOKEN ?? '';
// Resolved against the repo root, not the caller's cwd — the script has
// to work when it is run from anywhere.
const LOCAL_ENV_FILE = process.env.LOCAL_ENV_FILE
  ?? new URL('../.env.local', import.meta.url).pathname;

/**
 * Every var the product needs. Keep in sync with
 * `docs/launch-checklist.md` §1 — that table is the human-facing copy
 * of this list.
 */
const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'INCIDENT_ADMIN_TOKEN',
];

async function readLocalEnv(path) {
  try {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    const present = new Set();
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/);
      if (m && m[1]) present.add(m[1]);
    }
    return present;
  } catch {
    return null;
  }
}

async function readVercelEnv() {
  if (!VERCEL_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${PROJECT_ID}/env?decrypt=true`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } },
    );
    if (!res.ok) {
      console.error(`warn  Vercel env read failed: ${res.status}`);
      return null;
    }
    const body = await res.json();
    const envs = body?.envs ?? [];
    const present = new Set();
    for (const e of envs) {
      const targets = Array.isArray(e.target) ? e.target : [e.target];
      if (!targets.includes('production')) continue;
      if (e.value) present.add(e.key);
    }
    return present;
  } catch (err) {
    console.error(`warn  Vercel env read failed: ${err.message}`);
    return null;
  }
}

const local = await readLocalEnv(LOCAL_ENV_FILE);
const vercel = await readVercelEnv();

const mark = (set, key) => (set === null ? '?' : set.has(key) ? 'ok' : 'MISSING');

console.log(`\nenv audit — production (Vercel project ${PROJECT_ID})\n`);
console.log(`${'VAR'.padEnd(32)} ${'local'.padEnd(10)} vercel:production`);
for (const key of REQUIRED) {
  console.log(`${key.padEnd(32)} ${mark(local, key).padEnd(10)} ${mark(vercel, key)}`);
}

if (vercel === null) {
  console.log('\nRESULT: INCOMPLETE — could not read the Vercel production env (VERCELTOKEN missing or the API refused).');
  process.exit(1);
}

const missing = REQUIRED.filter((key) => !vercel.has(key));
if (missing.length === 0) {
  console.log('\nRESULT: PASS — every required var is present in the Vercel production env.');
  process.exit(0);
}

console.log(`\nRESULT: FAIL — ${missing.length} var(s) missing from production:`);
for (const key of missing) console.log(`  - ${key}`);
console.log('\nProvision them per docs/launch-checklist.md §1, then re-run this script.');
process.exit(1);
