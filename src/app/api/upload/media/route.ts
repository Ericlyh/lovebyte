import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';

/**
 * POST /api/upload/media — generic media upload for builders (Phase 7).
 *
 * Used by /create/multimedia-collage to upload photos / videos / audios.
 * The Phase 4 photo upload at /api/upload/photo is image-only; the
 * multimedia collage needs the other two kinds, so this route accepts
 * all three with per-kind size and MIME caps.
 *
 * Multipart form-data:
 *   file:     the media (required)
 *   kind:     'photo' | 'video' | 'audio' (required)
 *             — drives the size cap, the MIME allow-list, and the
 *               storage prefix so RLS prefixes stay tidy.
 *
 * Pipeline:
 *   1. Verify the request is authed.
 *   2. Validate mime + size per kind.
 *   3. Stream to the brand media bucket under
 *      `gifts/multimedia_collage/<user-id>/<kind>-<uuid>.<ext>`. The
 *      owner-CRL policy `media_owner_all` gates this.
 *   4. Insert a `gift_media` row referencing the storage path.
 *   5. Return `{ mediaId, publicUrl, kind }`.
 *
 * Per-kind caps (architecture §7 + §11 #3):
 *   - photo:  ≤ 5 MB · PNG/JPEG/WEBP
 *   - video:  ≤ 50 MB · MP4/WEBM/QuickTime
 *   - audio:  ≤ 25 MB · MP3/WAV/OGG/M4A
 *
 * Videos > 50 MB would normally switch to Mux per architecture §11 #3;
 * out of scope for the MVP — the sender sees an explicit 400 instead.
 *
 * Photos ALSO work via /api/upload/photo for backward compatibility
 * (memory-cards, dragdrop-puzzle reuse it). This route is the entry
 * point the multimedia collage builder uses for everything.
 */

export const runtime = 'nodejs';
// Multipart form-data + ArrayBuffer → Node runtime. Videos up to 50 MB
// need a generous maxDuration.
export const maxDuration = 60;

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;  // 5 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB

const ACCEPTED_PHOTO_MIME = z.enum(['image/png', 'image/jpeg', 'image/webp']);
const ACCEPTED_VIDEO_MIME = z.enum(['video/mp4', 'video/webm', 'video/quicktime']);
const ACCEPTED_AUDIO_MIME = z.enum([
  'audio/mpeg',  // mp3
  'audio/mp4',   // m4a / AAC
  'audio/wav',
  'audio/ogg',
  'audio/x-m4a', // Safari's iOS m4a
]);

const EXT_BY_MIME: Record<string, string> = {
  // photos
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  // videos
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  // audios
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/x-m4a': 'm4a',
};

const MEDIA_KIND = z.enum(['photo', 'video', 'audio']);

interface KindSpec {
  mimes: z.ZodTypeAny;
  max: number;
  defaultMimeError: string;
  defaultSizeError: string;
}

const KIND_SPEC: Record<z.infer<typeof MEDIA_KIND>, KindSpec> = {
  photo: {
    mimes: ACCEPTED_PHOTO_MIME,
    max: MAX_PHOTO_BYTES,
    defaultMimeError: 'Photo must be PNG, JPEG, or WEBP.',
    defaultSizeError: 'Photo is larger than 5 MB. Try a smaller image.',
  },
  video: {
    mimes: ACCEPTED_VIDEO_MIME,
    max: MAX_VIDEO_BYTES,
    defaultMimeError: 'Video must be MP4, WEBM, or MOV.',
    defaultSizeError: 'Video is larger than 50 MB. Trim it or pick a shorter clip.',
  },
  audio: {
    mimes: ACCEPTED_AUDIO_MIME,
    max: MAX_AUDIO_BYTES,
    defaultMimeError: 'Audio must be MP3, M4A, WAV, or OGG.',
    defaultSizeError: 'Audio is larger than 25 MB. Trim it.',
  },
};

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
      { ok: false, error: 'Sign in to upload media.' },
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

  const kindParse = MEDIA_KIND.safeParse(formData.get('kind'));
  if (!kindParse.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid kind. Use photo / video / audio.' },
      { status: 400 },
    );
  }
  const kind = kindParse.data;
  const spec = KIND_SPEC[kind];

  if (file.size === 0) {
    return NextResponse.json(
      { ok: false, error: 'Empty file.' },
      { status: 400 },
    );
  }
  if (file.size > spec.max) {
    return NextResponse.json(
      { ok: false, error: spec.defaultSizeError },
      { status: 400 },
    );
  }

  const mimeParse = spec.mimes.safeParse(file.type);
  if (!mimeParse.success) {
    return NextResponse.json(
      { ok: false, error: spec.defaultMimeError },
      { status: 400 },
    );
  }
  const mime = mimeParse.data as string;
  const ext = EXT_BY_MIME[mime] ?? 'bin';

  // Stable per-upload key so retry-on-failure produces a new path. The
  // bucket's filename uniqueness tolerates this.
  const path = `gifts/multimedia_collage/${user.id}/${kind}-${randomUUID()}.${ext}`;

  const bytes = await file.arrayBuffer();

  const { error: uploadErr } = await supabase.storage
    .from(BRAND.STORAGE_BUCKET)
    .upload(path, bytes, {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadErr) {
    console.error('[upload/media] storage upload failed', uploadErr.message);
    return NextResponse.json(
      { ok: false, error: `Upload failed: ${uploadErr.message}` },
      { status: 500 },
    );
  }

  // Insert gift_media row so the media is discoverable + quotable.
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
    await supabase.storage.from(BRAND.STORAGE_BUCKET).remove([path]);
    console.error('[upload/media] gift_media insert failed', insertErr?.message);
    return NextResponse.json(
      { ok: false, error: `Could not save media record: ${insertErr?.message ?? 'unknown error'}` },
      { status: 500 },
    );
  }

  // gifts/<kind>/<user-id>/... is publicly readable (brand media
  // bucket policy; see 0001_initial_schema + 0004_avatar_storage).
  const { data: publicUrlData } = supabase.storage
    .from(BRAND.STORAGE_BUCKET)
    .getPublicUrl(path);

  return NextResponse.json({
    ok: true,
    mediaId: inserted.id,
    publicUrl: publicUrlData.publicUrl,
    kind,
  });
}
