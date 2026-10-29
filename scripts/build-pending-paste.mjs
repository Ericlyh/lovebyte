/**
 * Build `supabase/PENDING_PASTE.sql` — the migrations that still have to
 * be applied by hand, concatenated into ONE paste.
 *
 * Why this exists: there is no SQL path from the agent host to the
 * Supabase project (the Management API PAT is dead, there is no database
 * password, and PostgREST cannot run DDL), so a human has to run these
 * in the Dashboard SQL Editor. Three files means three pastes; this is
 * one.
 *
 *   https://supabase.com/dashboard/project/xsfbfqzmvjfxppvoxbze/sql
 *
 * The output is GENERATED, so it cannot drift from the numbered
 * migrations it is built from — but it is a snapshot. When a migration
 * lands, delete it from PENDING below and re-run:
 *
 *   node scripts/build-pending-paste.mjs
 *
 * Every migration in this list is idempotent, so running the whole file
 * more than once is safe.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** The migrations that have not been applied to the project yet. */
const PENDING = [
  '0011_code_gift_type.sql',
  '0012_settlement_currency_hkd.sql',
  '0013_gifts_status_published.sql',
];

const header = `-- ============================================================================
-- PENDING_PASTE.sql — GENERATED, DO NOT EDIT
--
-- The Supabase migrations that still have to be applied to project
-- xsfbfqzmvjfxppvoxbze, concatenated so a human runs ONE paste instead of
-- three. Each section below is the full text of the numbered migration it
-- came from, so this file cannot drift from them.
--
--   https://supabase.com/dashboard/project/xsfbfqzmvjfxppvoxbze/sql
--
-- Regenerate with: node scripts/build-pending-paste.mjs
--
-- Every migration below is idempotent — running this file more than once is
-- safe.
-- ============================================================================
`;

const parts = PENDING.map((name) => {
  const sql = readFileSync(join(root, 'supabase', 'migrations', name), 'utf8');
  return `-- ############################################################################
-- FROM supabase/migrations/${name}
-- ############################################################################
${sql}`;
});

const out = join(root, 'supabase', 'PENDING_PASTE.sql');
writeFileSync(out, `${header}\n${parts.join('\n')}`);
console.log(`Wrote ${PENDING.length} migrations to supabase/PENDING_PASTE.sql`);
