-- ============================================================================
-- 0010_storage_bucket_rename.sql
--
-- OOP-6162 — rename the Storage bucket `lovebyte-media` → `lovorithm-media`.
--
-- ---------------------------------------------------------------------------
-- Why this file exists (the bucket id ≠ name trap)
-- ---------------------------------------------------------------------------
-- `storage.buckets` carries TWO identifiers: `id` (text) and `name` (text).
-- The Storage API resolves a bucket by **`id` only**:
--
--     supabase.storage.from(X)   works  ⟺   storage.buckets.id = X
--
-- Migration 0004 inserted the bucket as:
--
--     insert into storage.buckets (id, name, ...) values (gen_random_uuid(), 'lovebyte-media', ...)
--
-- so the row's `id` was a random UUID while its `name` was `lovebyte-media`.
-- Every upload route addresses the bucket by name, so
-- `supabase.storage.from('lovebyte-media')` never resolved and every
-- avatar / photo / media upload failed with:
--
--     { code: "NoSuchBucket", message: "Bucket not found" }
--
-- That is a pre-existing defect (it predates this rename — the bucket has
-- held zero objects since 2026-09-01) but the rename is the moment to fix
-- it: the new bucket gets `id = name = 'lovorithm-media'`, so the name the
-- app uses is the id the API resolves.
--
-- The bucket row itself can be created over the Storage REST API. The
-- **RLS policies on `storage.objects` cannot** — there is no policy
-- endpoint — so this file is the remaining piece and must be applied with:
--
--     SUPABASE_ACCESS_TOKEN=sbp_xxx \
--       node scripts/db-query.mjs --file supabase/migrations/0010_storage_bucket_rename.sql
--
-- or by pasting the whole file into the Dashboard SQL Editor for
-- project `xsfbfqzmvjfxppvoxbze`.
--
-- Idempotent: safe to run more than once.
-- ============================================================================


-- ---- 1. The renamed bucket -------------------------------------------------
-- `id` MUST equal `name` — see the trap above. `on conflict (name)` makes a
-- repeat run a no-op (the bucket may already have been created over the
-- Storage REST API).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lovorithm-media',
  'lovorithm-media',
  false,
  52428800,                        -- 50 MB — the app's own cap (video uploads)
  array[
    'image/png','image/jpeg','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/x-m4a'
  ]
)
on conflict (name) do nothing;

-- The app's three upload layouts, for reference:
--   avatars/<uid>/avatar-<uuid>.<ext>                   .../upload/avatar
--   gifts/<kind>/<uid>/photo-<uuid>.<ext>               .../upload/photo
--   gifts/multimedia_collage/<uid>/<kind>-<uuid>.<ext>  .../upload/media
-- In all three the owner's uid is the LAST path segment.


-- ---- 2. Storage RLS --------------------------------------------------------
-- `storage.objects` already has RLS enabled by Supabase; these policies
-- scope reads and writes to this bucket.

-- 2a. Public read for files under the avatars/ prefix. The /u/[handle]
--     page renders the avatar inline via getPublicUrl() with no per-request
--     signing roundtrip, so this has to be readable by anon.
drop policy if exists "media_avatars_public_select" on storage.objects;
create policy "media_avatars_public_select"
  on storage.objects for select
  to public
  using (
    bucket_id = 'lovorithm-media'
    and (storage.foldername(name))[1] = 'avatars'
  );

-- 2b. Public read for files under the gifts/ prefix.
--
--     The gift payload stores a *public* URL for each photo / video /
--     audio (see src/lib/actions/{dragdropPuzzle,memoryCards,
--     multimediaCollage}.ts — "the bucket is private but
--     gifts/<owner>/.../<file> is publicly readable ... without a signed
--     URL"), and the recipient's browser fetches it directly. No policy
--     has ever granted that read, so every gift with media renders broken.
--     It is created here because the new bucket needs a complete policy
--     set, and the intent is already documented in the app.
--
--     Privacy note: the gift media path embeds a uuid and the gift
--     itself is gated by its share token, so an unguessable URL is the
--     effective access control — same model the app already assumes.
drop policy if exists "media_gifts_public_select" on storage.objects;
create policy "media_gifts_public_select"
  on storage.objects for select
  to public
  using (
    bucket_id = 'lovorithm-media'
    and (storage.foldername(name))[1] = 'gifts'
  );

-- 2c. Owner CRUD. The owner is the LAST segment of the path (see the
--     layouts above).
--
--     0004's `media_owner_all` compared `auth.uid()` against path segment
--     [1], which matches none of the three real layouts:
--       - avatars/<uid>/…                 -> segment [1] is 'avatars'
--       - gifts/<kind>/<uid>/…            -> segment [1] is 'gifts'
--       - gifts/multimedia_collage/<uid>/… -> segment [1] is 'gifts'
--     so even with the policy present, uploads were denied. This version
--     anchors on the last segment instead.
drop policy if exists "media_owner_all" on storage.objects;
create policy "media_owner_all"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'lovorithm-media'
    and (storage.foldername(name))[1] in ('avatars', 'gifts')
    and auth.uid()::text = (storage.foldername(name))[array_length(storage.foldername(name), 1)]
  )
  with check (
    bucket_id = 'lovorithm-media'
    and (storage.foldername(name))[1] in ('avatars', 'gifts')
    and auth.uid()::text = (storage.foldername(name))[array_length(storage.foldername(name), 1)]
  );


-- ---- 3. Drop the old bucket -----------------------------------------------
-- The old bucket must be empty first. It is (zero objects since
-- 2026-09-01), but this migration refuses to run if that ever stops being
-- true — a silent object loss is not an acceptable outcome of a rename.
do $$
declare
  n bigint;
begin
  select count(*) into n
  from storage.objects
  where bucket_id = (select id from storage.buckets where name = 'lovebyte-media');

  if n > 0 then
    raise exception
      'lovebyte-media still holds % object(s) — copy them into lovorithm-media before running this migration',
      n;
  end if;
end
$$;

-- Remove any policy still pointing at the old bucket name. Matching on the
-- definition (rather than dropping by name) leaves the policies created in
-- section 2 — which reference 'lovorithm-media' — untouched.
do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (qual like '%lovebyte-media%' or with_check like '%lovebyte-media%')
  loop
    execute format('drop policy if exists %I on storage.objects', r.policyname);
  end loop;
end
$$;

delete from storage.buckets where name = 'lovebyte-media';
