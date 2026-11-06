#!/usr/bin/env node
/**
 * seed-catalog-kinds.mjs — give the seeded catalogue its kinds (OOP-7451).
 *
 * The kind of a gift — a birthday quiz, an apology letter — lives in the
 * gift's PAYLOAD, because `gifts.type` is a Postgres enum and
 * `gifts.category` is a CHECK-constrained column, so neither can take a
 * new value without DDL (and there is no DDL path from this host — see
 * `supabase/PENDING_PASTE.sql`).
 *
 * This script is the DATA half of that feature: it sets a kind on the
 * eight seeded catalogue listings, so the catalogue shows a spread of
 * kinds and the new occasion filter has something to filter.
 *
 * It is DML, so it runs through PostgREST with the secret key — no
 * migration, no dashboard paste.
 *
 * Idempotent: it MERGES the kind into the payload, so re-running it
 * changes nothing, and it never overwrites the rest of the payload.
 *
 * USAGE
 *   node scripts/seed-catalog-kinds.mjs            # apply
 *   node scripts/seed-catalog-kinds.mjs --dry-run  # print the plan only
 *
 * The payloads it replaces are backed up to
 * `~/.paperclip/lovebyte-catalogue-kinds-backup.json` before the first
 * write, so the change can be undone.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The kind of each seeded listing, by the listing's id.
 *
 * The ids are the fixed ids the catalogue seed wrote (see
 * `scripts/seed_catalog_covers.py`), so the mapping is stable and the
 * script is idempotent. The spread is the point: eight listings, eight
 * different kinds, so the catalogue reads as a catalogue of many kinds
 * of gift rather than eight variations of the same one.
 */
const KINDS = {
  'aaaa1111-0000-0000-0000-000000000001': 'friendship',
  'aaaa1111-0000-0000-0000-000000000002': 'just_because',
  'aaaa2222-0000-0000-0000-000000000001': 'long_distance',
  'aaaa3333-0000-0000-0000-000000000002': 'anniversary',
  'aaaa4444-0000-0000-0000-000000000001': 'thank_you',
  'aaaa5555-0000-0000-0000-000000000001': 'encouragement',
  'aaaa3333-0000-0000-0000-000000000001': 'birthday',
  'aaaa2222-0000-0000-0000-000000000002': 'graduation',
};

const BACKUP_PATH = join(
  process.env.HOME ?? '~',
  '.paperclip',
  'lovebyte-catalogue-kinds-backup.json',
);

function readEnvLocal() {
  return readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .reduce((acc, l) => {
      const [k, ...v] = l.split('=');
      acc[k.trim()] = v.join('=').trim();
      return acc;
    }, {});
}

const env = readEnvLocal();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const secret = env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing from .env.local');
  process.exit(2);
}

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
};

/** Read the current rows so the kind can be MERGED, not overwritten. */
async function readRows() {
  const ids = Object.keys(KINDS).join(',');
  const res = await fetch(
    `${url}/rest/v1/gifts?id=in.(${ids})&select=id,title,payload`,
    { headers },
  );
  if (!res.ok) {
    throw new Error(`read failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

const rows = await readRows();
if (rows.length === 0) {
  console.error('No seeded catalogue rows matched — has the catalogue been reseeded?');
  process.exit(1);
}

const plan = [];
for (const row of rows) {
  const kind = KINDS[row.id];
  if (!kind) continue;
  const payload = row.payload ?? {};
  if (payload.kind === kind) continue;
  plan.push({ id: row.id, title: row.title, kind, payload });
}

console.log(`${plan.length} listing(s) to update:`);
for (const p of plan) console.log(`  ${p.title} → ${p.kind}`);

if (plan.length === 0) {
  console.log('Nothing to do — every seeded listing already has its kind.');
  process.exit(0);
}

if (DRY_RUN) {
  console.log('\n(dry run — nothing written)');
  process.exit(0);
}

// Back up the payloads we are about to replace.
mkdirSync(dirname(BACKUP_PATH), { recursive: true });
writeFileSync(
  BACKUP_PATH,
  JSON.stringify(
    plan.map((p) => ({ id: p.id, title: p.title, payload: p.payload })),
    null,
    2,
  ),
);
console.log(`\nBackup: ${BACKUP_PATH}`);

for (const p of plan) {
  const res = await fetch(`${url}/rest/v1/gifts?id=eq.${p.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ payload: { ...p.payload, kind: p.kind } }),
  });
  if (!res.ok) {
    console.error(`  FAILED ${p.title}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`  ✓ ${p.title} → ${p.kind}`);
}

// Read one back, so the run cannot report success it did not achieve.
const check = await readRows();
const missing = Object.entries(KINDS).filter(([id, kind]) => {
  const row = check.find((r) => r.id === id);
  return !row || (row.payload ?? {}).kind !== kind;
});
if (missing.length > 0) {
  console.error(`\n${missing.length} listing(s) did not take their kind:`);
  for (const [id, kind] of missing) console.error(`  ${id} → ${kind}`);
  process.exit(1);
}
console.log(`\nAll ${Object.keys(KINDS).length} seeded listings carry their kind.`);
