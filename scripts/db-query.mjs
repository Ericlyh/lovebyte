#!/usr/bin/env node
/**
 * db-query.mjs — run a SQL query (or file) against the Supabase project via
 * the Management API. Usage:
 *
 *   node scripts/db-query.mjs "select 1"
 *   node scripts/db-query.mjs --file supabase/migrations/0002_x.sql
 *
 * Requires:
 *   SUPABASE_ACCESS_TOKEN  env var (PAT from supabase.com/dashboard/account/tokens)
 *   NEXT_PUBLIC_SUPABASE_URL  in .env.local (just for the project ref)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
let sql;
if (args[0] === '--file' && args[1]) {
  const p = args[1].startsWith('/') ? args[1] : join(root, args[1]);
  sql = readFileSync(p, 'utf8');
} else {
  sql = args.join(' ');
}

const pat = process.env.SUPABASE_ACCESS_TOKEN;
if (!pat) {
  console.error('Set SUPABASE_ACCESS_TOKEN=<your PAT>');
  process.exit(2);
}
const envLocal = readFileSync(join(root, '.env.local'), 'utf8')
  .split('\n')
  .filter(l => l && !l.startsWith('#'))
  .reduce((acc, l) => {
    const [k, ...v] = l.split('=');
    acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});
const ref = envLocal.NEXT_PUBLIC_SUPABASE_URL
  .replace('https://', '')
  .replace('.supabase.co', '');

const url = `https://api.supabase.com/v1/projects/${ref}/database/query`;
const resp = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const body = await resp.text();
console.log('HTTP', resp.status);
console.log(body);
process.exit(resp.ok ? 0 : 1);
