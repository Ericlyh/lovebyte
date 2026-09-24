-- Lovorithm — incidents (Phase 10, OOP-4226)
--
-- Public status page backing table. The /status route reads the last 7
-- days of incidents to render the operational state — `current_severity`
-- on the most recent open row drives the headline pill ("All systems
-- operational" / "Some systems degraded" / "Active outage").
--
-- Apply ON TOP OF 0008_waitlist.sql. Idempotent (IF NOT EXISTS + do $$
-- blocks per lovebyte-supabase-mgmt-api-fk-gotcha).
--
-- Assumptions explicit (CLAUDE.md §1):
--   A. Status enum is intentionally coarse — four levels that map to
--      the headline pill text on /status. Free-form `body` is the
--      long-form update ("We're seeing elevated 502s on /create…").
--      Adding finer-grained statuses is a UI decision, not a schema
--      migration, as long as the headline still uses these four.
--   B. `resolved_at` is NULL while the incident is open; setting it
--      closes the incident. The /status query is "open = resolved_at
--      IS NULL", so to reopen an incident, set resolved_at back to
--      NULL (and bump updated_at so subscribers re-notice).
--   C. No FK to `profiles` for `created_by`. Service-role inserts
--      only (see server-side insert note in src/app/api/incidents),
--      and we don't want orphaned-FK noise if the on-call operator
--      later rotates out of the team.
--   D. RLS: anon SELECT only. Inserts / updates / deletes go through
--      the service-role client in a future admin route — out of scope
--      for this slice (the public /status page is read-only).

-- ============================================================================
-- incidents — status-page log
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'incident_severity') then
    create type public.incident_severity as enum (
      'operational',  -- green: nothing wrong, the table is empty for "all OK"
      'maintenance',  -- amber: scheduled work in progress
      'degraded',     -- amber: partial impact, some users affected
      'outage'        -- red:   significant impact, core flow broken
    );
  end if;
end
$$;

create table if not exists public.incidents (
  id              uuid                    primary key default gen_random_uuid(),
  severity        public.incident_severity not null,
  title           text                    not null check (char_length(title) between 1 and 200),
  body            text                    check (body is null or char_length(body) <= 4000),
  status          text                    not null default 'investigating'
                                                check (status in ('investigating','identified','monitoring','resolved')),
  created_at      timestamptz             not null default now(),
  updated_at      timestamptz             not null default now(),
  resolved_at     timestamptz
);

-- Headline query: "open incident with the highest severity wins." The
-- /status page selects the row whose `resolved_at` IS NULL, ordered
-- by severity DESC (outage > degraded > maintenance > operational).
-- Operational is the only severity allowed to close with `resolved_at`
-- IS NOT NULL; in practice we delete operational "events" instead of
-- keeping them as resolved rows.
create index if not exists incidents_open_severity_idx
  on public.incidents (severity, created_at desc)
  where resolved_at is null;

-- Last 7 days feed.
create index if not exists incidents_recent_idx
  on public.incidents (created_at desc);

-- updated_at trigger — re-uses the same pattern as gift_replies
-- (M-G, OOP-4890): a tiny before-update function so future edit UI
-- has a stable ordering signal without each call site remembering.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'incidents_set_updated_at') then
    create trigger incidents_set_updated_at
      before update on public.incidents
      for each row execute function public.set_updated_at();
  end if;
end
$$;

-- ============================================================================
-- RLS — anon SELECT only; writes are service-role (OOP-4226 acceptance)
-- ============================================================================
alter table public.incidents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy where polname = 'incidents_select_public'
  ) then
    create policy incidents_select_public
      on public.incidents
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;
