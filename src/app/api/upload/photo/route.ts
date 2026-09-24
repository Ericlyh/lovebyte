import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/upload/photo — generic photo upload for builders (Phase 4).
 *
 * Used by /create/memory-cards to upload photo pairs. The avatar route
 * (/api/upload/avatar) is purpose-built for profile avatars; this is
 * the per-gift-type photo endpoint and is the pattern future builders
 * (dragdrop_puzzle, multimedia_collage, …) will reuse.
 *
 * Multipart form-data:
 *   file:   the photo (required)
 *   kind:   'memory_cards' | 'dragdrop_puzzle' | 'multimedia_collage'
 *           — controls the storage prefix so RLS prefixes stay tidy
 *           and so future quota accounting can be per-kind.
 *
 * Pipeline:
 *   1. Verify the request is authed.
 *   2. Validate mime (PNG/JPEG/WEBP) + size (≤ 5 MB).
 *   3. Stream to `lovebyte-media` under
 *      `gifts/<kind>/<user-id>/photo-<uuid>.<ext>`. The owner-CRL policy
 *      `media_owner_all` gates this.
 *   4. Insert a `gift_media` row referencing the storage path.
 *   5. Return `{ mediaId, publicUrl }`. The builder stashes `mediaId`
 *      in hidden form fields until save.
 *
 * Why 5 MB? Photos for memory_cards need to look good on retina
 * (~600×800) but should still fit the SSR payload budget comfortably.
 * Larger photos can be optimized client-side before upload.
 *
 * Status codes mirror /api/upload/avatar.
 */

export const runtime = 'nodejs';
// Photos are larger than avatars (≤ 5 MB) and form-data parsing lives on Node.
export const maxDuration = 30;

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

const ACCEPTED_MIME = z.enum(['image/png', 'image/jpeg', 'image/webp']);

const EXT_BY_MIME: Record<z.infer<typeof ACCEPTED_MIME>, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const PHOTO_KIND = z.enum([
  'memory_cards',
  'dragdrop_puzzle',
  'multimedia_collage',
]);

export async function POST(request: Request) {
  let supabase;
  try {
    supabase = await createClient();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Supabase client init failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to upload photos.' },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Could not read upload: ${e instanceof Error ? e.message : String(e)}` },
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
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Photo is larger than 5 MB. Try a smaller image.' },
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

  const kindParse = PHOTO_KIND.safeParse(formData.get('kind') ?? 'memory_cards');
  if (!kindParse.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid kind. Use memory_cards / dragdrop_puzzle / multimedia_collage.' },
      { status: 400 },
    );
  }
  const kind = kindParse.data;

  // Stable per-upload key so retry-on-failure produces a new path. The
  // bucket's filename uniqueness tolerates this.
  const path = `gifts/${kind}/${user.id}/photo-${randomUUID()}.${ext}`;

  const bytes = await file.arrayBuffer();

  const { error: uploadErr } = await supabase.storage
    .from('lovebyte-media')
    .upload(path, bytes, {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadErr) {
    console.error('[upload/photo] storage upload failed', uploadErr.message);
    return NextResponse.json(
      { ok: false, error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // Insert gift_media row so the photo is discoverable + quotable.
  // RLS `gift_media_all_own` lets the user insert their own row.
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
    await supabase.storage.from('lovebyte-media').remove([path]);
    console.error('[upload/photo] gift_media insert failed', insertErr?.message);
    return NextResponse.json(
      { ok: false, error: `Could not save photo record: ${insertErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  // gifts/<kind>/<user-id>/... is publicly readable (lovebyte-media
  // bucket policy; see 0001_initial_schema + 0004_avatar_storage).
  const { data: publicUrlData } = supabase.storage
    .from('lovebyte-media')
    .getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    mediaId: inserted.id,
    publicUrl: publicUrlData.publicUrl,
  });
}
