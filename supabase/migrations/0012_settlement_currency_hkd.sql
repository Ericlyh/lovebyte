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
