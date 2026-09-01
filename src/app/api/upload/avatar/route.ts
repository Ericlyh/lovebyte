import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/upload/avatar — avatar upload (M-B follow-up, OOP-4310).
 *
 * Multipart form-data with a single `file` field. The route:
 *   1. Verifies the request is authed (no avatar uploads for anon).
 *   2. Validates mime (PNG/JPEG/WEBP/GIF) + size (≤ 2 MB).
 *   3. Streams the bytes to the `lovebyte-media` bucket under
 *      `avatars/<user-id>/avatar-<uuid>.<ext>`. The owner-CRL policy
 *      (`media_owner_all`) gates this — the SSR client passes the user's
 *      JWT, so `auth.uid()` resolves correctly inside the RLS check.
 *   4. Inserts a `gift_media` row so the avatar is discoverable via the
 *      existing `profiles.avatar_media_id` FK + `profiles_public` join.
 *   5. Returns `{ mediaId, publicUrl }`. The client stashes `mediaId`
 *      in a hidden form field so the subsequent `upsertProfileAction`
 *      call updates `profiles.avatar_media_id`.
 *
 * Why server-side upload instead of a signed PUT URL? Avatars are small
 * (≤ 2 MB) and the policy is "always server-validated" — easier to
 * enforce mime/size in one place than to sign a URL and trust the
 * client. The README's "uploads go through /api/upload" convention is
 * already this shape.
 *
 * Status codes:
 *   200 { ok: true, mediaId, publicUrl }   — uploaded + media row inserted
 *   400 { ok: false, error }               — missing file / bad mime / too large
 *   401 { ok: false, error }               — no authenticated user
 *   500 { ok: false, error }               — storage / DB failure
 */

export const runtime = 'nodejs';
// Avatars are large-ish (≤ 2 MB) and form-data parsing lives on Node.
export const maxDuration = 30;

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB

const ACCEPTED_MIME = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const EXT_BY_MIME: Record<z.infer<typeof ACCEPTED_MIME>, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(request: Request) {
  let supabase;
  try {
    supabase = await createClient();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Supabase client init failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to upload an avatar.' },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Could not read upload: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: 'Missing file field.' },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { ok: false, error: 'Empty file.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Avatar is larger than 2 MB. Try a smaller image.' },
      { status: 400 },
    );
  }
  const mimeParse = ACCEPTED_MIME.safeParse(file.type);
  if (!mimeParse.success) {
    return NextResponse.json(
      { ok: false, error: `Unsupported image type: ${file.type}.` },
      { status: 400 },
    );
  }
  const mime = mimeParse.data;
  const ext = EXT_BY_MIME[mime];

  // Stable per-upload key so retry-on-failure produces a new path (the
  // bucket's filename uniqueness tolerates this). Owner-scoped prefix so
  // the RLS policy `media_owner_all` lets the user write here.
  const path = `avatars/${user.id}/avatar-${randomUUID()}.${ext}`;

  // Bytes → ArrayBuffer for the Supabase storage SDK.
  const bytes = await file.arrayBuffer();

  const { error: uploadErr } = await supabase.storage
    .from('lovebyte-media')
    .upload(path, bytes, {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadErr) {
    console.error('[upload/avatar] storage upload failed', uploadErr.message);
    return NextResponse.json(
      { ok: false, error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // Insert the gift_media row so the avatar is referenceable from
  // profiles.avatar_media_id. RLS `gift_media_all_own` lets the user
  // insert their own row.
  const { data: inserted, error: insertErr } = await supabase
    .from('gift_media')
    .insert({
      owner_id: user.id,
      storage_path: path,
      mime,
      byte_size: file.size,
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    // Best-effort cleanup so the bucket doesn't leak orphan files.
    await supabase.storage.from('lovebyte-media').remove([path]);
    console.error('[upload/avatar] gift_media insert failed', insertErr?.message);
    return NextResponse.json(
      { ok: false, error: `Could not save avatar record: ${insertErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  // The avatars/ prefix is publicly readable (see media_avatars_public_select
  // in 0004_avatar_storage.sql), so getPublicUrl is the right shape here.
  const { data: publicUrlData } = supabase.storage
    .from('lovebyte-media')
    .getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    mediaId: inserted.id,
    publicUrl: publicUrlData.publicUrl,
  });
}
