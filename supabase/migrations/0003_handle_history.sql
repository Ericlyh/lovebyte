-- ============================================================================
-- 0003_handle_history.sql — handle-change history + 30-day cooldown RPC
--
-- Part C of the OOP-4284 reviewed login flow. Lets the user change their
-- public handle, but rate-limits changes (30 days) and keeps an audit
-- trail so old `/u/<old-handle>` URLs can 301-redirect to the new one.
--
-- Authoritative parent: OOP-4284 (M-B step 3 follow-up, comment 339c9a62).
-- ============================================================================

-- 1. Add the cooldown column. Default `now()` so existing rows have a
--    sensible "you can change again on day X" anchor without a separate
--    backfill pass.
alter table public.profiles
  add column if not exists handle_changed_at timestamptz not null default now();

-- Backfill handle_changed_at for any rows that pre-date this migration
-- (defensive: the DEFAULT already handles new rows).
update public.profiles
  set handle_changed_at = created_at
  where handle_changed_at = handle_changed_at -- intentional no-op guard
    and handle_changed_at > created_at;

-- 2. History table. One row per accepted handle change. `old_handle` is
--    UNIQUE so `/u/[handle]/page.tsx` can do an O(1) redirect lookup
--    without scanning.
create table if not exists public.handle_history (
  id          bigserial primary key,
  profile_id  uuid        not null references public.profiles(id) on delete cascade,
  old_handle  text        not null,
  new_handle  text        not null,
  changed_at  timestamptz not null default now(),
  unique (old_handle)
);

create index if not exists handle_history_profile_idx
  on public.handle_history (profile_id, changed_at desc);

-- 3. RLS. The table holds public data (handles are public via
--    profiles_public) so anon SELECT is allowed. Writes go through the
--    service_role path (server actions) or the trigger — never directly
--    from an end-user client.
alter table public.handle_history enable row level security;
alter table public.handle_history force  row level security;

drop policy if exists handle_history_select_public on public.handle_history;
create policy handle_history_select_public
  on public.handle_history for select
  using (true);

-- 4. Trigger that mirrors handle updates into handle_history. The trigger
--    is the canonical writer so the action layer can stay thin.
create or replace function public.record_handle_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.handle_history (profile_id, old_handle, new_handle, changed_at)
  values (new.id, old.handle, new.handle, now());
  new.handle_changed_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_handle_change_trg on public.profiles;
create trigger profiles_handle_change_trg
  after update of handle on public.profiles
  for each row
  when (old.handle is distinct from new.handle)
  execute function public.record_handle_change();

-- 5. RPC: change_handle(p_id, p_new_handle). Defence-in-depth — even if
--    the server action logic is bypassed, the RPC enforces the cooldown
--    and the format check.
create or replace function public.change_handle(
  p_id          uuid,
  p_new_handle  text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_handle text;
  v_changed_at     timestamptz;
  v_normalised     text;
  v_final          text;
  i                int;
begin
  -- Normalise the input the same way the app does (handle.ts).
  v_normalised := lower(trim(p_new_handle));
  if v_normalised is null
     or v_normalised !~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$' then
    raise exception 'invalid_handle' using errcode = '22023';
  end if;

  -- Load current row.
  select handle, handle_changed_at
    into v_current_handle, v_changed_at
  from public.profiles
  where id = p_id
  for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  -- Cooldown (30 days). The action layer also checks this so the user
  -- gets a friendly "you can change again in N days" message; the RPC
  -- is the canonical enforcement point.
  if v_changed_at > now() - interval '30 days' and v_current_handle <> v_normalised then
    raise exception 'cooldown_active' using errcode = 'P0001';
  end if;

  -- If the new handle collides with an existing profile, append a
  -- numeric suffix until unique (mirrors handle_new_user's strategy).
  v_final := v_normalised;
  i := 0;
  while exists(select 1 from public.profiles where handle = v_final and id <> p_id) loop
    i := i + 1;
    v_final := substr(v_normalised, 1, 19) || i::text;
    if length(v_final) > 20 then
      raise exception 'handle_collision_unresolvable' using errcode = 'P0001';
    end if;
  end loop;

  -- Apply. The trigger writes the history row + bumps handle_changed_at.
  update public.profiles
    set handle = v_final
  where id = p_id;

  return v_final;
end;
$$;

-- 6. Grant execute on the RPC to the anon + service_role. Service role
--    is what the server action uses (via createClient's user-context);
--    anon gets a no-op grant so the function is callable from PostgREST
--    when the request carries the user's JWT (which still runs as the
--    authenticated user, NOT service_role).
grant execute on function public.change_handle(uuid, text) to authenticated;
grant execute on function public.change_handle(uuid, text) to service_role;
