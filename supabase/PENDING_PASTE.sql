-- ============================================================================
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

-- ############################################################################
-- FROM supabase/migrations/0011_code_gift_type.sql
-- ############################################################################
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

-- ############################################################################
-- FROM supabase/migrations/0012_settlement_currency_hkd.sql
-- ############################################################################
-- ============================================================================
-- 0012_settlement_currency_hkd.sql
--
-- OOP-6714 — settle the marketplace in ONE currency (HKD).
--
-- ---------------------------------------------------------------------------
-- Why this file is not applied by the agent
-- ---------------------------------------------------------------------------
-- Same reasons as 0011: there is no SQL path from the agent host to this
-- project (the Management API PAT is dead, there is no database password,
-- and PostgREST cannot run DDL). A human has to paste this into the
-- Dashboard SQL Editor for project `xsfbfqzmvjfxppvoxbze`.
--
--   https://supabase.com/dashboard/project/xsfbfqzmvjfxppvoxbze/sql
--
-- Idempotent: safe to run more than once. The data conversion only
-- touches rows whose currency is NOT already 'HKD', and both CHECK
-- constraints are dropped before being re-added.
-- ============================================================================


-- ---- 0. Pre-flight: is every priced row convertible? ------------------------
-- The conversion table below covers the seven currencies the old publish
-- form offered. If a row carries something else, this query returns it —
-- and the CHECK constraint in step 2 will refuse to install until it is
-- dealt with, which is the behaviour we want: fail loudly rather than
-- re-price a listing with a rate we do not have.
--
-- Expected: zero rows.
select id, title, price_cents, currency
  from public.gifts
 where price_cents is not null
   and upper(btrim(currency)) not in ('HKD','USD','EUR','GBP','CAD','AUD','JPY');


-- ---- 1. Convert the legacy catalogue to HKD --------------------------------
--
-- The catalogue shipped with prices in three currencies (HKD, USD, EUR)
-- behind filter labels written in dollars. Converting the stored amounts
-- ONCE, here, is what makes "one settlement currency" true: after this
-- runs, every `price_cents` is HKD cents and the app never has to think
-- about FX again.
--
-- FX POLICY: the rates below are the ECB reference rates for 2026-10-28,
-- expressed as HKD per one unit of the source currency
-- (frankfurter.dev, base USD). They are a fixed, dated policy rate — not
-- a live feed — because a listing's price must not move after it is
-- published. Re-price the catalogue by hand if the rates need updating;
-- do not turn this into a lookup table.
--
--   USD -> HKD  7.8451
--   EUR -> HKD  8.7340
--   GBP -> HKD 10.4243
--   CAD -> HKD  5.5849
--   AUD -> HKD  5.5173
--   JPY -> HKD  0.0497
--
-- ROUNDING: the converted amount is rounded to the nearest HKD cent.
-- The platform fee is computed on that cent amount and rounded down
-- again (see `platformFeeCents` in `src/lib/money.ts`).

with rates(currency, hkd_per_unit) as (
  values
    ('USD', 7.8451),
    ('EUR', 8.7340),
    ('GBP', 10.4243),
    ('CAD', 5.5849),
    ('AUD', 5.5173),
    ('JPY', 0.0497)
)
update public.gifts g
   set price_cents = round(g.price_cents * r.hkd_per_unit)::int,
       currency    = 'HKD'
  from rates r
 where upper(btrim(g.currency)) = r.currency
   and g.price_cents is not null;

-- Free listings (price_cents IS NULL) have no amount to convert, but
-- they still carry a currency and the constraint below covers them.
update public.gifts
   set currency = 'HKD'
 where price_cents is null
   and upper(btrim(currency)) <> 'HKD';


-- ---- 2. Constrain the currency ---------------------------------------------
--
-- `gifts.currency` is `char(3) not null default 'HKD'`. The CHECK makes
-- a mixed-currency row impossible to insert, so the catalogue cannot
-- drift back to three currencies the way it did.

alter table public.gifts drop constraint if exists gifts_currency_chk;
alter table public.gifts add  constraint gifts_currency_chk
  check (currency = 'HKD');

-- `purchases.currency` records what Stripe settled. The marketplace
-- settles in HKD only, so the ledger may only hold HKD.
alter table public.purchases drop constraint if exists purchases_currency_chk;
alter table public.purchases add  constraint purchases_currency_chk
  check (currency = 'HKD');


-- ---- 3. Verify -------------------------------------------------------------
-- Both of these should return one row each.

select conname, pg_get_constraintdef(oid) from pg_constraint
 where conname in ('gifts_currency_chk', 'purchases_currency_chk')
 order by conname;

-- Should return zero rows.
select id, title, price_cents, currency
  from public.gifts
 where currency <> 'HKD';

-- The catalogue, in its settlement currency.
select id, title, price_cents, currency
  from public.gifts
 where price_cents is not null
 order by price_cents;

-- ############################################################################
-- FROM supabase/migrations/0013_gifts_status_published.sql
-- ############################################################################
-- ============================================================================
-- 0013_gifts_status_published.sql
--
-- OOP-6717 — a listed gift is a PUBLISHED gift.
--
-- ---------------------------------------------------------------------------
-- Why this file is not applied by the agent
-- ---------------------------------------------------------------------------
-- Same reasons as 0011 and 0012: there is no SQL path from the agent host to
-- this project (the Management API PAT is dead, there is no database password,
-- and PostgREST cannot run DDL). A human has to paste this into the
-- Dashboard SQL Editor for project `xsfbfqzmvjfxppvoxbze`.
--
--   https://supabase.com/dashboard/project/xsfbfqzmvjfxppvoxbze/sql
--
-- Idempotent: safe to run more than once. The CHECK constraint is dropped
-- before being re-added, and the backfill only touches rows that are not
-- already 'published'.
-- ============================================================================


-- ---- 1. Allow the 'published' status ---------------------------------------
--
-- `gifts.status` was CHECK-constrained to ('draft','sent','archived') by
-- migration 0001. Those three values describe the SENDER's lifecycle
-- (a gift being drafted, or sent), and none of them says anything about
-- the MARKETPLACE. Every listed row therefore sat at 'draft', and a
-- catalogue visitor could not tell a published listing from a work in
-- progress.
--
-- 'published' is the marketplace state: the row is listed and visible.
-- `is_listed` stays the source of truth for visibility — this constraint
-- only stops the two from drifting apart silently.

alter table public.gifts drop constraint if exists gifts_status_check;
alter table public.gifts add  constraint gifts_status_check
  check (status in ('draft','sent','archived','published'));


-- ---- 2. Backfill the listed catalogue --------------------------------------
--
-- Every row that is listed and live becomes 'published'. A row that is
-- not listed keeps whatever lifecycle status it had ('draft' while the
-- creator is still working on it, 'sent' once it has gone out).

update public.gifts
   set status = 'published'
 where is_listed = true
   and deleted_at is null
   and status <> 'published';


-- ---- 3. Verify -------------------------------------------------------------
-- This should return the constraint with 'published' in it.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname = 'gifts_status_check';

-- Every live listed row should be 'published'.
select status, count(*)
  from public.gifts
 where is_listed = true
   and deleted_at is null
 group by status;
