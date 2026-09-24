-- LoveByte — public waitlist (Phase 10, OOP-4226)
--
-- Pre-account email capture for the beta landing page. Distinct from
-- `profiles` (which only exists for users who have signed up via the
-- normal auth flow). Insert path is gated by a Turnstile check inside
-- `joinWaitlistAction` (src/lib/actions/waitlist.ts) using the service-role
-- client; this table has no INSERT policy for anon / authenticated so a
-- client that bypasses the server action is rejected.
--
-- Apply ON TOP OF 0007_gift_replies.sql. Idempotent
-- (uses IF NOT EXISTS / `do $$` blocks per lovebyte-supabase-mgmt-api-fk-gotcha).
--
-- Assumptions explicit (CLAUDE.md §1):
--   A. Email is the canonical id — case-insensitive unique constraint so
--      `Foo@x.com` and `foo@x.com` cannot both register. Stored lowercased.
--   B. `intent` is free-form text rather than a hard enum so the
--      landing-page copy can iterate ("personal / hk-sme / creator")
--      without a schema migration each time. Cap at 64 chars.
--   C. `ip_hash` + `ua_hash` are SHA-256 of (ip + UA), not raw values, so
--      the table carries no direct PII beyond the email itself. These
--      back the rate-limit decision in `joinWaitlistAction` (one
--      submission per IP-hash per hour) without the GDPR cost of
--      retaining raw IPs.
--   D. No FK to `profiles` — waitlist entries predate account creation
--      and we don't want orphaned-FK noise on profile deletion. A
--      future "convert waitlist entry → profile" job can match on the
--      lowercased email at signup time.

-- ============================================================================
-- waitlist — pre-account email captures
-- ============================================================================
create table if not exists public.waitlist (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null,
  email_lc      text        not null generated always as (lower(email)) stored,
  intent        text        check (intent is null or char_length(intent) <= 64),
  locale        text        not null default 'en'
                            check (locale in ('en','zh-Hant')),
  source        text        check (source is null or char_length(source) <= 64),
  ip_hash       text        check (ip_hash is null or char_length(ip_hash) = 64),
  ua_hash       text        check (ua_hash is null or char_length(ua_hash) = 64),
  created_at    timestamptz not null default now()
);

-- Case-insensitive unique on the canonical lowercased email. Re-running
-- this migration is safe because `create unique index if not exists`
-- is a no-op when the index already exists.
create unique index if not exists waitlist_email_lc_uniq
  on public.waitlist (email_lc);

-- Rate-limit lookup: how recently did this IP / UA submit? The server
-- action queries this on each submission to reject bursts.
create index if not exists waitlist_ip_recent_idx
  on public.waitlist (ip_hash, created_at desc)
  where ip_hash is not null;

create index if not exists waitlist_ua_recent_idx
  on public.waitlist (ua_hash, created_at desc)
  where ua_hash is not null;

-- ============================================================================
-- enable RLS — policies live in 0002_marketplace_v2_rls.sql
-- ============================================================================
-- Deliberately NO anon-INSERT policy. The server action uses the service-role
-- client (which bypasses RLS) and is the only insert path; turning this on
-- without the Turnstile gate would invite unlimited spam.
alter table public.waitlist enable row level security;