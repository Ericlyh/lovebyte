#!/usr/bin/env node
/**
 * Apply the money-path env vars to the Lovorithm production deploy (OOP-6168).
 *
 * `scripts/check-env.mjs` is the read side of this: it reports whether the
 * required vars are present in production. This is the write side — it reads
 * the four values out of a 600-mode file a human wrote, sets them in the
 * Vercel production environment, mirrors them into `.env.local`, and deletes
 * the file.
 *
 * The file route exists so the values never touch the issue thread, the repo
 * or a shell history. Same pattern as `~/.paperclip/lovebyte-incident-admin-token`.
 *
 *   node scripts/apply-money-env.mjs ~/.paperclip/lovebyte-money-env
 *
 * File format: one KEY=value per line, no quoting, no `export`. Blank lines
 * and `#` comments are ignored.
 *
 * Requires `VERCELTOKEN` in the environment (or a token in the Vercel CLI's
 * global config). Values are never printed and never written to a log.
 *
 * Exit code: 0 = every requested var was set in production,
 *             1 = something failed (missing var, bad file, API refused).
 *
 * NOTE: setting the vars is necessary but NOT sufficient for the money path.
 * See `docs/launch-checklist.md` §1.1 — the Stripe account also needs Connect
 * enabled and three webhook events subscribed.
 */

import { readFileSync, writeFileSync, chmodSync, unlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? 'prj_C9TIIEni96mFmt7WIF1gfh4Nq8dj';
const VERCEL_TOKEN = process.env.VERCELTOKEN ?? process.env.VERCEL_API_TOKEN ?? '';
const DEFAULT_INPUT = `${homedir()}/.paperclip/lovebyte-money-env`;

/** The vars this script exists to set. Anything else in the file is rejected. */
const SETTABLE = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM',
];

const LOCAL_ENV_FILE = process.env.LOCAL_ENV_FILE
  ?? new URL('../.env.local', import.meta.url).pathname;

const inputPath = process.argv[2] ?? DEFAULT_INPUT;

if (!VERCEL_TOKEN) {
  console.error('VERCELTOKEN is not set — cannot reach the Vercel API.');
  process.exit(1);
}

if (!existsSync(inputPath)) {
  console.error(`No env file at ${inputPath}.`);
  console.error('Expected one KEY=value per line, e.g.:');
  console.error('  STRIPE_SECRET_KEY=sk_live_...');
  console.error('  STRIPE_WEBHOOK_SECRET=whsec_...');
  console.error('  RESEND_API_KEY=re_...');
  console.error('  RESEND_FROM="Lovorithm <hello@your-verified-domain>"');
  process.exit(1);
}

// A world-readable file of live secrets is the exact failure this route
// exists to prevent, so refuse rather than proceed.
const mode = (process.env.SECRET_FILE_MODE ?? '600');
try {
  const stat = (await import('node:fs')).statSync(inputPath);
  const perms = stat.mode & 0o777;
  if (perms & 0o077) {
    console.error(`${inputPath} is mode ${perms.toString(8)} — it is readable by others.`);
    console.error('Run: chmod 600 ' + inputPath);
    process.exit(1);
  }
} catch (err) {
  console.error(`Could not stat ${inputPath}: ${err.message}`);
  process.exit(1);
}

const raw = readFileSync(inputPath, 'utf8');
const values = {};
const unknown = [];

for (const line of raw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) {
    console.error(`Malformed line (no "="): ${trimmed.slice(0, 40)}`);
    process.exit(1);
  }
  const key = trimmed.slice(0, eq).trim();
  // Strip one layer of surrounding quotes if present.
  const value = trimmed.slice(eq + 1).trim().replace(/^"(.*)"$/s, '$1');
  if (!value) {
    console.error(`${key} has an empty value.`);
    process.exit(1);
  }
  if (!SETTABLE.includes(key)) {
    unknown.push(key);
    continue;
  }
  values[key] = value;
}

if (unknown.length > 0) {
  console.error(`Unexpected key(s) in the file: ${unknown.join(', ')}`);
  console.error(`Only these may be set by this script: ${SETTABLE.join(', ')}`);
  process.exit(1);
}

if (Object.keys(values).length === 0) {
  console.error('The file contained no recognised vars.');
  process.exit(1);
}

console.log(`read ${Object.keys(values).length} var(s) from ${inputPath} (values not printed)`);

async function setVercelEnv(key, value) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?upsert=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      // `upsert=true` is required: a plain POST returns 400 ENV_CONFLICT if
      // the key already exists for the target.
      body: JSON.stringify({
        key,
        value,
        type: 'encrypted',
        target: ['production'],
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${key}: Vercel API ${res.status} ${body.slice(0, 200)}`);
  }
}

let failures = 0;
for (const key of Object.keys(values)) {
  try {
    await setVercelEnv(key, values[key]);
    console.log(`ok    ${key} set in Vercel production`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL  ${err.message}`);
  }
}

// Mirror into .env.local for local dev. Only the vars we were given are
// added; nothing else in the file is touched.
try {
  let local = existsSync(LOCAL_ENV_FILE) ? readFileSync(LOCAL_ENV_FILE, 'utf8') : '';
  let changed = false;
  for (const key of Object.keys(values)) {
    const line = `${key}=${values[key]}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(local)) {
      local = local.replace(re, line);
    } else {
      local = local.replace(/\s*$/, '\n') + line + '\n';
    }
    changed = true;
  }
  if (changed) {
    writeFileSync(LOCAL_ENV_FILE, local, { mode: 0o600 });
    console.log(`ok    mirrored into ${LOCAL_ENV_FILE} (mode 600)`);
  }
} catch (err) {
  console.error(`warn  could not mirror into ${LOCAL_ENV_FILE}: ${err.message}`);
  console.error('      production is unaffected by this.');
}

// Delete the file once the values are in Vercel. If a var failed, leave the
// file in place so the human does not have to re-supply everything.
if (failures === 0) {
  try {
    unlinkSync(inputPath);
    console.log(`ok    deleted ${inputPath}`);
  } catch (err) {
    console.error(`warn  could not delete ${inputPath}: ${err.message}`);
  }
} else {
  console.error(`\n${failures} var(s) failed, so ${inputPath} was KEPT for a retry.`);
}

if (failures > 0) process.exit(1);

console.log('\nNEXT: the vars are set but the deploy still has the old environment baked in.');
console.log('  1. Redeploy:  vercel redeploy <current-deployment-id> --environment production');
console.log('     (or push to origin/main — the GitHub webhook auto-deploys)');
console.log('  2. Verify:    node scripts/check-env.mjs');
console.log('  3. Re-gate:   node scripts/readiness-gate.mjs');
console.log('The money path also needs Stripe Connect + 3 webhook events — see');
console.log('docs/launch-checklist.md §1.1.');
process.exit(0);
