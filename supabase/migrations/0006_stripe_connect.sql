-- ============================================================================
-- M-E: Stripe Connect destination charges + webhook (OOP-4277)
--
-- Idempotent migration. Run AFTER 0005_gift_like_count_fix.sql.
--
-- Three additions:
--   1. profiles.stripe_account_id + stripe_charges_enabled
--      Tracks each creator's Stripe Connect Express state.
--      Format check on `acct_…` is defence-in-depth against malformed
--      writes from the webhook's `account.updated` handler.
--   2. purchases.stripe_session_id
--      Lets /checkout/success look up the purchase from the
--      Stripe-hosted Checkout redirect without a second Stripe API call.
--   3. stripe_webhook_events
--      Generic dedup table — every webhook handler must check
--      `INSERT ... ON CONFLICT DO NOTHING` BEFORE its dispatch.
-- ============================================================================

-- 1. profiles: Stripe Connect state per creator
alter table public.profiles
  add column if not exists stripe_account_id      text unique,
  add column if not exists stripe_charges_enabled boolean not null default false;

alter table public.profiles drop constraint if exists profiles_stripe_account_fmt_chk;
alter table public.profiles add  constraint profiles_stripe_account_fmt_chk
  check (stripe_account_id is null or stripe_account_id ~ '^acct_[A-Za-z0-9]+$');

-- 2. purchases: success-page lookup key
alter table public.purchases
  add column if not exists stripe_session_id text;

create unique index if not exists purchases_stripe_session_uidx
  on public.purchases (stripe_session_id) where stripe_session_id is not null;

-- 3. Webhook event dedup
create table if not exists public.stripe_webhook_events (
  event_id     text        primary key,
  event_type   text        not null,
  processed_at timestamptz not null default now()
);

-- Service-role grants.
-- service_role has BYPASSRLS, so RLS doesn't block, but PostgREST still
-- needs explicit GRANTs for the table to be reachable via the REST API.
grant usage on schema public to service_role;
grant select, insert on public.stripe_webhook_events to service_role;
grant select, insert, update on public.purchases to service_role;
grant select, update on public.profiles to service_role;
