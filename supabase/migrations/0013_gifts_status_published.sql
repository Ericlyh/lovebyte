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
