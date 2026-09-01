-- ============================================================================
-- 0004_avatar_storage.sql
--
-- M-B follow-up (OOP-4310): avatar Storage bucket + RLS + write-path.
--
-- Decision (vs. a separate `avatars` bucket): reuse the documented
-- `lovebyte-media` bucket — single bucket keeps the storage RLS surface
-- minimal and avoids creating a parallel naming space. Avatars live under
-- the `avatars/<user-id>/` prefix; other media lives under `<user-id>/`
-- directly (see `gift_media.storage_path` convention in 0001).
--
-- Path layout:
--   lovebyte-media/avatars/<user-id>/avatar-<uuid>.<ext>
--
-- Read model:
--   - Public SELECT under the `avatars/` prefix only — the /u/[handle]
--     page renders the avatar inline via getPublicUrl() with no per-request
--     signing roundtrip.
--   - Everything else stays private; non-avatar media requires a signed
--     URL.
--
-- Write model:
--   - Owner-only INSERT/UPDATE/DELETE under either prefix, gated by the
--     first path segment matching auth.uid(). The server-side upload
--     helper (`POST /api/upload/avatar`) is the single writer — the
--     bucket name never appears in client code.
-- ============================================================================

-- ---- 1. Bucket --------------------------------------------------------------
-- Idempotent: created on first apply, no-op on subsequent runs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  gen_random_uuid(),
  'lovebyte-media',
  false,
  20971520,                                    -- 20 MB (avatar limit enforced server-side at 2 MB)
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (name) do nothing;

-- ---- 2. Storage RLS ---------------------------------------------------------
-- `storage.objects` already has RLS enabled by Supabase. We add the four
-- policies that scope reads/writes for this bucket.

-- Public read for files under the avatars/ prefix only.
drop policy if exists "media_avatars_public_select" on storage.objects;
create policy "media_avatars_public_select"
  on storage.objects for select
  to public
  using (
    bucket_id = 'lovebyte-media'
    and (storage.foldername(name))[1] = 'avatars'
  );

-- Owner CRUD on any path under their user-id folder (covers both
-- `avatars/<user-id>/...` and `<user-id>/...` gift media).
drop policy if exists "media_owner_all" on storage.objects;
create policy "media_owner_all"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'lovebyte-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'lovebyte-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
