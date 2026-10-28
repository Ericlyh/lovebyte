-- ============================================================================
-- 0011_code_gift_type.sql
--
-- OOP-5688 — add the `code` gift type (upload HTML/CSS/JS as a gift).
--
-- ---------------------------------------------------------------------------
-- Why this file is not applied by the agent
-- ---------------------------------------------------------------------------
-- There is no SQL path from the agent host to this project:
--
--   - the Supabase Management API PAT (SUPABASEACCESSTOKEN_LOVEBYTE) returns
--     401 "Invalid access token";
--   - there is no database password in the environment, so `psql` /
--     `supabase db push` cannot connect either;
--   - the project exposes no `exec_sql`-style RPC and pg_graphql is not
--     enabled, so PostgREST cannot run DDL.
--
-- So this file has to be applied by a human: paste it into the Dashboard
-- SQL Editor for project `xsfbfqzmvjfxppvoxbze` (or run it with a working
-- PAT: `SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-migration.mjs`).
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ---- 1. The gift type ------------------------------------------------------
-- `gift_type` is a Postgres enum (migration 0001), so a new gift type needs
-- an ALTER TYPE. PG 12+ allows this inside a transaction block as long as
-- the new value is not USED in the same transaction — it is not used here.
alter type public.gift_type add value if not exists 'code';


-- ---- 2. The category CHECK -------------------------------------------------
-- `gifts.category` is a text column with a CHECK constraint (migration
-- 0002). It is denormalised from the gift type for the /browse category
-- filters, so the new type has to be allowed there too.
--
-- Note the column is nullable, so a code gift could be stored with
-- `category = NULL` and still work — but then it would have no category
-- filter of its own on /browse.
alter table public.gifts drop constraint if exists gifts_category_chk;
alter table public.gifts add constraint gifts_category_chk
  check (category is null or category in (
    'memory_cards','dragdrop_puzzle','quiz','multimedia_collage','animated_letter','code'
  ));


-- ---- 3. Verify -------------------------------------------------------------
-- Both of these should return one row each. If the first returns nothing,
-- the enum value did not take.
select enumlabel from pg_enum
  join pg_type on pg_type.oid = pg_enum.enumtypid
 where typname = 'gift_type' and enumlabel = 'code';

select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname = 'gifts_category_chk';
