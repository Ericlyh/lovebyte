import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { uploadMediaObject, removeMediaObject } from '@/lib/supabase/storage';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { BRAND } from '@/lib/brand';

/**
 * GET /api/readiness/media — can the media path still store and serve a file?
 *
 * Why this exists (OOP-5816, 2026-10-28): for the whole life of the
 * project, NO photo, video, audio or avatar had ever been uploaded, and
 * the readiness gate reported the site as healthy. Two independent
 * defects were hiding behind a green gate:
 *
 *   1. the upload routes wrote with the user-scoped client, and the
 *      `storage.objects` RLS policies had never been applied to the live
 *      project — so every upload died with "new row violates row-level
 *      security policy";
 *   2. the app hands out `getPublicUrl()` URLs, which Storage's public
 *      endpoint only serves for a PUBLIC bucket — the bucket was
 *      private, so even a stored object rendered as a broken image.
 *
 * Neither is visible from a page load or an HTTP status, so this route
 * performs the roundtrip the product actually depends on: write an
 * object through the same helper the upload routes use, fetch it back
 * with NO auth header (exactly what the recipient's browser does), and
 * delete it again.
 *
 * It writes one 33-byte 1x1 PNG under `gifts/_readiness/` and removes
 * it in the same request — it is a probe, not a storage endpoint, and it
 * never returns anything but pass/fail detail.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROBE_PATH = `gifts/_readiness/probe-${randomUUID()}.png`;

// 1x1 transparent PNG.
//
// `new Uint8Array(Buffer.from(...))` copies the 33 decoded bytes into an
// ArrayBuffer of exactly that size. Passing `Buffer.from(...)` directly
// would hand over the whole pooled 64 KB ArrayBuffer behind it, and the
// object written to the bucket would be 33 bytes of PNG followed by
// 65 KB of unrelated pool memory.
const PROBE_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

// PNG magic number — the first 8 bytes of every PNG file.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export async function GET() {
  const result: {
    ok: boolean;
    bucket: string;
    write?: string;
    read?: { status: number; contentType: string | null; bytes: number };
    error?: string;
  } = { ok: false, bucket: BRAND.STORAGE_BUCKET };

  let publicUrl: string | null = null;

  try {
    const { error } = await uploadMediaObject(PROBE_PATH, PROBE_BYTES.buffer, {
      contentType: 'image/png',
    });
    if (error) {
      result.error = `write failed: ${error.message}`;
      return NextResponse.json(result, { status: 503, headers: { 'cache-control': 'no-store' } });
    }
    result.write = 'ok';

    const supabase = await createServiceRoleClient();
    publicUrl = supabase.storage.from(BRAND.STORAGE_BUCKET).getPublicUrl(PROBE_PATH).data
      .publicUrl;

    // The read is deliberately unauthenticated — this is the recipient's
    // browser fetching the file.
    const res = await fetch(publicUrl, { cache: 'no-store' });
    const bytes = Buffer.from(await res.arrayBuffer());
    result.read = {
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: bytes.length,
    };

    const isPng = PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
    result.ok = res.status === 200 && bytes.length === PROBE_BYTES.length && isPng;
    if (!result.ok) {
      result.error = `read returned ${res.status} (${result.read.contentType ?? 'no content-type'}), ${
        bytes.length
      } bytes${isPng ? '' : ' — not a PNG'}`;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    try {
      await removeMediaObject(PROBE_PATH);
    } catch {
      // A leftover probe object is harmless; never mask the real result.
    }
  }

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
