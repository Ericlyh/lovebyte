-- LoveByte — marketplace schema v2
-- Source of decisions: interaction afb9c1c5 (resolved 2026-08-26T07:14:58Z).
-- Encodes the 5 marketplace decisions:
--   monetization      = platform_take_pct
--   listing_model     = gift_is_listing
--   payments_timing   = instant_on_purchase
--   creator_onboarding= open_self_serve
--   recipient_at_purchase = both_supported
--
-- Mirrors design/04-architecture/marketplace-schema-v2.md.
--
-- Apply ON TOP OF 0001_initial_schema.sql. Idempotent (uses IF NOT EXISTS).
--
-- Assumptions made explicit (per CLAUDE.md §1):
--   A. gifts.deleted_at is added here because the new RLS policy in
--      0002_marketplace_v2_rls.sql depends on it, but the OOP-4273 body lists
--      the new columns without it. Soft-delete semantics, not yet exposed in
--      the UI — application code is expected to set deleted_at when unpublishing.
--   B. LOVEBYTE_MIN_FEE_BPS = 500 (5%). Encoded as a CHECK constraint
--      `platform_fee_bps between 500 and 10000`. Creators can lower from the
--      10% baseline but not below 5%. Change the constant here if the platform
--      policy shifts.
--   C. profiles_public view excludes avatar_url (which holds a private storage
--      path) in favour of the new avatar_media_id join. profiles doesn't
--      currently have email/phone columns, so those are not in the redaction
--      list — if email/phone get added later, add them to the projection.

-- ============================================================================
-- profiles — extend for public creator profile (M-B)
-- ============================================================================
alter table public.profiles
  add column if not exists handle              text unique,
  add column if not exists avatar_media_id     uuid references public.gift_media(id) on delete set null,
  add column if not exists bio                 text,
  add column if not exists links               jsonb not null default '[]'::jsonb;

-- Backfill handles for any pre-existing profiles so the NOT NULL add succeeds.
-- Pattern: 'u' + first 13 hex chars of md5(id) = 14 chars total, well under
-- the 20-char M-B cap. Numeric suffix appended on collision.
do $$
declare
  r        record;
  candidate text;
  i        int;
begin
  for r in select id from public.profiles where handle is null loop
    candidate := 'u' || substr(md5(r.id::text), 1, 13);
    i := 0;
    while exists(select 1 from public.profiles where handle = candidate) loop
      i := i + 1;
      candidate := 'u' || substr(md5(r.id::text), 1, 13) || i::text;
    end loop;
    update public.profiles set handle = candidate where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column handle set not null;

-- display_name becomes optional now that handle is the public key.
alter table public.profiles alter column display_name drop not null;

-- Bio length cap (matches M-B spec: 600 chars).
alter table public.profiles drop constraint if exists profiles_bio_len_chk;
alter table public.profiles add  constraint profiles_bio_len_chk
  check (bio is null or char_length(bio) <= 600);

-- Handle format: kebab-case, 3–20 chars, no leading/trailing dash, no uppercase.
-- Matches OOP-4274 (M-B) spec.
alter table public.profiles drop constraint if exists profiles_handle_fmt_chk;
alter table public.profiles add  constraint profiles_handle_fmt_chk
  check (handle ~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$');

create unique index if not exists profiles_handle_uidx on public.profiles (handle);

-- ============================================================================
-- gifts — listing columns + soft-delete + search (M-C/M-F)
-- ============================================================================
alter table public.gifts
  add column if not exists is_listed        boolean     not null default false,
  add column if not exists price_cents      integer,
  add column if not exists currency         char(3)     not null default 'HKD',
  add column if not exists published_at     timestamptz,
  add column if not exists cover_media_id   uuid        references public.gift_media(id) on delete set null,
  add column if not exists category         text,
  add column if not exists platform_fee_bps integer     not null default 1000,
  add column if not exists description      text,
  add column if not exists deleted_at       timestamptz;

-- platform_fee_bps: LOVEBYTE_MIN_FEE_BPS (500 = 5%) ≤ fee ≤ 100% (10000 bps).
alter table public.gifts drop constraint if exists gifts_platform_fee_bps_chk;
alter table public.gifts add  constraint gifts_platform_fee_bps_chk
  check (platform_fee_bps between 500 and 10000);

-- price_cents: NULL = free / 'contact creator'; otherwise > 0.
alter table public.gifts drop constraint if exists gifts_price_cents_chk;
alter table public.gifts add  constraint gifts_price_cents_chk
  check (price_cents is null or price_cents > 0);

-- category denormalised from gift type for catalog filters.
alter table public.gifts drop constraint if exists gifts_category_chk;
alter table public.gifts add  constraint gifts_category_chk
  check (category is null or category in (
    'memory_cards','dragdrop_puzzle','quiz','multimedia_collage','animated_letter'
  ));

-- description length cap (M-F publish card: 500 chars).
alter table public.gifts drop constraint if exists gifts_description_len_chk;
alter table public.gifts add  constraint gifts_description_len_chk
  check (description is null or char_length(description) <= 500);

-- Full-text search vector (used by /browse search in M-C).
-- Generated column → no trigger needed; reads stay consistent with title/description.
alter table public.gifts drop column if exists search_tsv;
alter table public.gifts add  column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('simple', coalesce(title,       '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'B')
  ) stored;

-- Catalog indexes: partial on listed+live, plus a GIN on the search vector.
create index if not exists gifts_listed_published_idx
  on public.gifts (published_at desc)
  where is_listed = true and deleted_at is null;

create index if not exists gifts_search_tsv_idx
  on public.gifts using gin (search_tsv);

create index if not exists gifts_category_listed_idx
  on public.gifts (category, published_at desc)
  where is_listed = true and deleted_at is null;

create index if not exists gifts_creator_listed_idx
  on public.gifts (owner_id, published_at desc)
  where is_listed = true and deleted_at is null;

-- ============================================================================
-- purchases (M-E) — destination-charge ledger; service-role writes only.
--
-- NOTE: shares uses token (text) as PK (URL-safe random hex for /g/[token]),
-- NOT id. share_id here is text and FKs to public.shares(token).
-- ============================================================================
create table if not exists public.purchases (
  id                       uuid        primary key default gen_random_uuid(),
  buyer_id                 uuid        not null,
  gift_id                  uuid        not null,
  amount_cents             integer     not null check (amount_cents > 0),
  platform_fee_cents       integer     not null check (platform_fee_cents >= 0),
  creator_payout_cents     integer     not null check (creator_payout_cents >= 0),
  currency                 char(3)     not null,
  stripe_payment_intent_id text        unique,
  status                   text        not null default 'paid'
                                       check (status in ('paid','refunded')),
  delivery_mode            text        not null
                                       check (delivery_mode in ('send_to_recipient','buyer_shares')),
  recipient_contact        text,
  share_id                 text,
  created_at               timestamptz not null default now(),
  refunded_at              timestamptz
);

-- FKs added separately for idempotency on re-run (see ALTERs at end of file).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'purchases_buyer_fk') then
    alter table public.purchases
      add constraint purchases_buyer_fk
      foreign key (buyer_id) references public.profiles(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchases_gift_fk') then
    alter table public.purchases
      add constraint purchases_gift_fk
      foreign key (gift_id) references public.gifts(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'purchases_share_fk') then
    alter table public.purchases
      add constraint purchases_share_fk
      foreign key (share_id) references public.shares(token) on delete set null;
  end if;
end $$;

create index if not exists purchases_buyer_idx       on public.purchases (buyer_id, created_at desc);
create index if not exists purchases_gift_idx        on public.purchases (gift_id, created_at desc);
create index if not exists purchases_status_idx      on public.purchases (status);
create index if not exists purchases_share_idx       on public.purchases (share_id);

-- ============================================================================
-- gift_likes (M-D)
-- ============================================================================
create table if not exists public.gift_likes (
  profile_id uuid        not null,
  gift_id    uuid        not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, gift_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gift_likes_profile_fk') then
    alter table public.gift_likes add constraint gift_likes_profile_fk
      foreign key (profile_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gift_likes_gift_fk') then
    alter table public.gift_likes add constraint gift_likes_gift_fk
      foreign key (gift_id) references public.gifts(id) on delete cascade;
  end if;
end $$;

create index if not exists gift_likes_gift_idx on public.gift_likes (gift_id, created_at desc);

-- ============================================================================
-- gift_comments (M-D)
-- ============================================================================
create table if not exists public.gift_comments (
  id         uuid        primary key default gen_random_uuid(),
  gift_id    uuid        not null,
  author_id  uuid        not null,
  body       text        not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gift_comments_gift_fk') then
    alter table public.gift_comments add constraint gift_comments_gift_fk
      foreign key (gift_id) references public.gifts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gift_comments_author_fk') then
    alter table public.gift_comments add constraint gift_comments_author_fk
      foreign key (author_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists gift_comments_gift_live_idx
  on public.gift_comments (gift_id, created_at desc)
  where deleted_at is null;

create index if not exists gift_comments_author_idx
  on public.gift_comments (author_id, created_at desc);

-- ============================================================================
-- creator_follows (M-B/M-D)
-- ============================================================================
create table if not exists public.creator_follows (
  follower_id uuid        not null,
  creator_id  uuid        not null,
  created_at  timestamptz not null default now(),
  primary key (follower_id, creator_id),
  check (follower_id <> creator_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creator_follows_follower_fk') then
    alter table public.creator_follows add constraint creator_follows_follower_fk
      foreign key (follower_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'creator_follows_creator_fk') then
    alter table public.creator_follows add constraint creator_follows_creator_fk
      foreign key (creator_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists creator_follows_creator_idx on public.creator_follows (creator_id, created_at desc);

-- ============================================================================
-- comment_reports (M-D moderation)
-- ============================================================================
create table if not exists public.comment_reports (
  id          uuid        primary key default gen_random_uuid(),
  comment_id  uuid        not null,
  reporter_id uuid        not null,
  reason      text        not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comment_reports_comment_fk') then
    alter table public.comment_reports add constraint comment_reports_comment_fk
      foreign key (comment_id) references public.gift_comments(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comment_reports_reporter_fk') then
    alter table public.comment_reports add constraint comment_reports_reporter_fk
      foreign key (reporter_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists comment_reports_comment_idx on public.comment_reports (comment_id, created_at desc);
create index if not exists comment_reports_open_idx    on public.comment_reports (created_at desc)
  where resolved_at is null;

-- ============================================================================
-- Update handle_new_user() so new signups get a handle.
-- Priority: raw_user_meta_data->>'handle' (set by /signup) > email-prefix > hash.
-- Collision-aware: appends numeric suffix if a generated handle already exists.
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
  i         int;
begin
  -- Pick a handle: explicit metadata handle first.
  candidate := coalesce(
    nullif(new.raw_user_meta_data->>'handle', ''),
    nullif(split_part(new.email, '@', 1), '')
  );

  -- If the candidate isn't well-formed (regex fails) or collides, synthesise.
  if candidate is null or candidate !~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$' then
    candidate := 'u' || substr(md5(new.id::text), 1, 13);
  end if;

  i := 0;
  while exists(select 1 from public.profiles where handle = candidate) loop
    i := i + 1;
    candidate := substr(candidate, 1, 19) || i::text;  -- keep ≤ 20 chars
  end loop;

  insert into public.profiles (id, display_name, handle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    candidate
  );
  return new;
end;
$$;

-- ============================================================================
-- gift_like_count(gift_id)  — SECURITY DEFINER aggregate.
-- Lets anon read like counts (M-C / /l/[giftId]) without being able to
-- enumerate who liked. Stable so the planner can memoize.
-- ============================================================================
create or replace function public.gift_like_count(gift_id uuid)
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::bigint from public.gift_likes where gift_likes.gift_id = gift_id;
$$;

grant execute on function public.gift_like_count(uuid) to anon, authenticated;

-- ============================================================================
-- profiles_public  — anon-safe projection of public.profiles.
-- Created with security_invoker = true so the underlying RLS still applies
-- (defence in depth: even if anon is granted SELECT on this view, the base
-- table's policies must allow the read). Excludes avatar_url (a private
-- storage path) in favour of the avatar_media_id join.
-- ============================================================================
create or replace view public.profiles_public
with (security_invoker = true) as
  select
    p.id,
    p.handle,
    p.display_name,
    p.avatar_media_id,
    p.bio,
    p.links,
    p.created_at
  from public.profiles p;

grant select on public.profiles_public to anon, authenticated;

-- ============================================================================
-- Enable RLS on the new tables. Policies live in 0002_marketplace_v2_rls.sql.
-- ============================================================================
alter table public.purchases       enable row level security;
alter table public.gift_likes      enable row level security;
alter table public.gift_comments   enable row level security;
alter table public.creator_follows enable row level security;
alter table public.comment_reports enable row level security;
