/**
 * Apply one or more supabase migrations to the Supabase Cloud project
 * using the Management API (POST /v1/projects/{ref}/database/query).
 *
 * Requires a Supabase Personal Access Token from
 *   https://supabase.com/dashboard/account/tokens
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migration.mjs
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migration.mjs supabase/migrations/0011_code_gift_type.sql
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migration.mjs a.sql b.sql c.sql
 *
 * Files are applied in the order given. With no argument it applies
 * 0001_initial_schema.sql, which is what this script did before it
 * could be pointed at a specific migration.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY from .env.local.
 * The Secret key is unused here — only the PAT authenticates the Management API.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['supabase/migrations/0001_initial_schema.sql'];

for (const file of files) {
  const path = resolve(root, file);
  const sql = readFileSync(path, 'utf8');

  console.log(`Applying ${file} (${sql.split('\n').length} lines) to ${ref}...`);
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
  if (!resp.ok) {
    console.log('Body:', body.slice(0, 1500));
    process.exit(1);
  }
  console.log(`${file} applied successfully.`);
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
