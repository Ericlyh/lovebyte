/**
 * Apply supabase/migrations/0001_initial_schema.sql to the Supabase Cloud project
 * using the Management API (POST /v1/projects/{ref}/database/query).
 *
 * Requires a Supabase Personal Access Token from
 *   https://supabase.com/dashboard/account/tokens
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migration.mjs
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY from .env.local.
 * The Secret key is unused here — only the PAT authenticates the Management API.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const envLocal = readFileSync(join(root, '.env.local'), 'utf8')
  .split('\n')
  .filter(l => l && !l.startsWith('#'))
  .reduce((acc, l) => {
    const [k, ...v] = l.split('=');
    acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const pat = process.env.SUPABASE_ACCESS_TOKEN;
if (!pat) {
  console.error('Set SUPABASE_ACCESS_TOKEN=<your PAT from https://supabase.com/dashboard/account/tokens>');
  process.exit(2);
}

const url = envLocal.NEXT_PUBLIC_SUPABASE_URL;
const ref = url.replace('https://', '').replace('.supabase.co', '');
const sql = readFileSync(join(root, 'supabase', 'migrations', '0001_initial_schema.sql'), 'utf8');

console.log(`Applying ${sql.split('\n').length} lines of SQL to ${ref}...`);
const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${pat}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const body = await resp.text();
console.log('Status:', resp.status);
if (resp.ok) {
  console.log('Migration applied successfully.');
} else {
  console.log('Body:', body.slice(0, 1500));
  process.exit(1);
}

// Verify
const v = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: "select tablename from pg_tables where schemaname='public' order by tablename"
  }),
});
const tables = await v.json();
console.log('Public tables now:', tables.map(t => t.tablename).join(', '));
