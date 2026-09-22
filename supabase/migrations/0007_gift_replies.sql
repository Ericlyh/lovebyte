-- LoveByte — gift_replies (M-G, OOP-4890)
--
-- Threaded buyer-question replies on listing detail. Distinct from
-- gift_comments (M-D): replies are *questions to the creator* and are
-- permitted to nest via parent_reply_id, while comments are flat
-- public feedback.
--
-- Apply ON TOP OF 0002_marketplace_v2.sql. Idempotent (uses IF NOT
-- EXISTS / `do $$` blocks for FKs per lovebyte-supabase-mgmt-api-fk-gotcha).
--
-- Assumptions explicit (CLAUDE.md §1):
--   A. `gift_id` cascades on gift delete — same shape as gift_comments.
--   B. `user_id` cascades on profile delete — same shape as
--      gift_comments.author_id; RLS still gates the action.
--   C. `parent_reply_id` is nullable for top-level replies, FK cascades
--      so a deleted parent removes the whole subtree (rare — only via
--      admin / service_role; the public RLS DELETE only covers
--      own-message deletion which sets updated_at but keeps the row).
--   D. `updated_at` is set by a trigger on UPDATE so future edit UI
--      has a stable ordering signal; the initial insert also stamps
--      it via DEFAULT now().

-- ============================================================================
-- gift_replies — threaded buyer→creator questions (M-G, OOP-4890)
-- ============================================================================
create table if not exists public.gift_replies (
  id              uuid        primary key default gen_random_uuid(),
  gift_id         uuid        not null,
  user_id         uuid        not null,
  parent_reply_id uuid,
  body            text        not null check (char_length(body) between 1 and 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- FKs added separately for idempotency on re-run.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gift_replies_gift_fk') then
    alter table public.gift_replies add constraint gift_replies_gift_fk
      foreign key (gift_id) references public.gifts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gift_replies_user_fk') then
    alter table public.gift_replies add constraint gift_replies_user_fk
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gift_replies_parent_fk') then
    alter table public.gift_replies add constraint gift_replies_parent_fk
      foreign key (parent_reply_id) references public.gift_replies(id) on delete cascade;
  end if;
end $$;

-- Live-thread index: replies for a gift, ordered oldest-first for stable
-- threaded rendering. parent_reply_id secondary for in-memory grouping.
create index if not exists gift_replies_gift_live_idx
  on public.gift_replies (gift_id, parent_reply_id nulls first, created_at)
  where body is not null;

-- Replies by user (for the authed user's own reply history, future use).
create index if not exists gift_replies_user_idx
  on public.gift_replies (user_id, created_at desc);

-- updated_at trigger so future edit UI has a stable ordering signal.
create or replace function public.gift_replies_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists gift_replies_touch_updated_at_trg on public.gift_replies;
create trigger gift_replies_touch_updated_at_trg
  before update on public.gift_replies
  for each row execute function public.gift_replies_touch_updated_at();

-- ============================================================================
-- enable RLS — policies live in 0002_marketplace_v2_rls.sql
-- ============================================================================
alter table public.gift_replies enable row level security;