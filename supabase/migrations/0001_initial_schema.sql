-- LoveByte — initial schema
-- Mirrors design/04-architecture/architecture.md §3.
-- Apply with: supabase db push   OR
--             psql -h <host> -U postgres -d postgres -f 0001_initial_schema.sql

-- ============================================================================
-- profiles  (1:1 with auth.users)
-- ============================================================================
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'zh-Hant')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- gift_type enum + gifts table
-- ============================================================================
create type gift_type as enum (
  'memory_cards',
  'dragdrop_puzzle',
  'quiz',
  'multimedia_collage',
  'animated_letter'
);

create table public.gifts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  type gift_type not null,
  title text,
  -- Type-specific payload (JSONB). The builder for each gift type writes
  -- its own shape here; a Zod schema in src/features/<type>/schemas.ts
  -- validates the boundary.
  --   memory_cards:       {pairs: [{photo_url, caption}], difficulty, card_back, music_url}
  --   dragdrop_puzzle:    {photo_url, grid: 3|4|5, reveal_message}
  --   quiz:               {questions: [{q, options, correct_idx, reveal_msg}]}
  --   multimedia:         {template, media: [{type, url, caption, position}], music_url}
  --   letter:             {markdown, paper, envelope_color, inline_media: [...]}
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','sent','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gifts_owner_idx on public.gifts (owner_id, created_at desc);

-- ============================================================================
-- gift_media  (decoupled so the same photo can be reused across gifts)
-- ============================================================================
create table public.gift_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null,           -- 'lovebyte-media/<owner>/<uuid>.<ext>'
  mime text not null,
  width int,
  height int,
  byte_size bigint,
  created_at timestamptz not null default now()
);

create index gift_media_owner_idx on public.gift_media (owner_id, created_at desc);

-- ============================================================================
-- shares  (one per sent gift; publicly resolvable via /g/[token])
-- ============================================================================
create table public.shares (
  token text primary key default encode(gen_random_bytes(16), 'hex'),
  gift_id uuid not null references public.gifts(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz,
  password_hash text,                   -- optional password gate
  view_count int not null default 0,
  unique_opened_at timestamptz,         -- first open (for the "opened 🎉" badge)
  last_opened_at timestamptz,
  created_at timestamptz not null default now()
);

create index shares_gift_idx on public.shares (gift_id);

-- ============================================================================
-- share_replies  (anonymous reply from recipient → sender)
-- ============================================================================
create table public.share_replies (
  id uuid primary key default gen_random_uuid(),
  share_token text not null references public.shares(token) on delete cascade,
  message text,
  voice_note_url text,
  photo_url text,
  created_at timestamptz not null default now()
);

create index share_replies_token_idx on public.share_replies (share_token, created_at desc);

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table profiles      enable row level security;
alter table gifts         enable row level security;
alter table gift_media    enable row level security;
alter table shares        enable row level security;
alter table share_replies enable row level security;

-- profiles ────────────────────────────────────────────────────────────────
-- Owner can SELECT/UPDATE own row; anyone (incl. anon recipient) can SELECT
-- display_name for the "from Eric" line on the recipient view.
create policy "profiles_select_public_display_name"
  on profiles for select
  using (true);

create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "profiles_insert_own"
  on profiles for insert
  with check (auth.uid() = id);

-- gifts ────────────────────────────────────────────────────────────────────
-- Owner can do everything on own gifts; nobody else can SELECT.
create policy "gifts_all_own"
  on gifts for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- gift_media ───────────────────────────────────────────────────────────────
-- Same as gifts.
create policy "gift_media_all_own"
  on gift_media for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- shares ───────────────────────────────────────────────────────────────────
-- Owner of underlying gift can SELECT/INSERT.
-- Recipients (anon) can SELECT to resolve /g/[token] (envelope view).
create policy "shares_select_public_by_token"
  on shares for select
  using (true);

create policy "shares_insert_owner"
  on shares for insert
  with check (auth.uid() = created_by);

create policy "shares_update_owner"
  on shares for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

create policy "shares_delete_owner"
  on shares for delete
  using (auth.uid() = created_by);

-- share_replies ────────────────────────────────────────────────────────────
-- Anyone with the share token can INSERT (no account needed for reply).
-- Gift owner can SELECT to see replies.
create policy "share_replies_insert_anon"
  on share_replies for insert
  with check (true);

create policy "share_replies_select_owner"
  on share_replies for select
  using (
    exists (
      select 1 from public.shares s
      where s.token = share_replies.share_token
        and s.created_by = auth.uid()
    )
  );

-- ============================================================================
-- Auto-create a profile row when a new auth.users row appears
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Touch updated_at on row update
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger gifts_touch_updated_at
  before update on public.gifts
  for each row execute function public.touch_updated_at();
