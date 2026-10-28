import 'server-only';
import { createServiceRoleClient } from './service-role';
import { BRAND } from '@/lib/brand';

/**
 * Media-bucket object writes.
 *
 * The upload routes write through the service-role client rather than the
 * user-scoped one. Why (OOP-5816, 2026-10-28):
 *
 *   - The `storage.objects` RLS policies live in migration 0010 and have
 *     never been applied to the live project (there is no SQL path from
 *     this host: the Management API PAT is dead and there is no db
 *     password). An owner-scoped write therefore fails with
 *     "new row violates row-level security policy" — which is exactly
 *     what the deployed `POST /api/upload/photo` returned (HTTP 500).
 *     No photo, video, audio or avatar has ever been uploaded.
 *   - The route authenticates the caller first (`auth.getUser()` → 401
 *     without a session) and derives the object path from that session's
 *     user id, so the service role removes the RLS dependency without
 *     widening who can write. A user still cannot write into another
 *     user's prefix.
 *
 * The `gift_media` INSERT deliberately stays on the user-scoped client,
 * so the database keeps enforcing ownership (`gift_media_all_own`).
 */

/** Write an object into the brand media bucket. */
export async function uploadMediaObject(
  path: string,
  body: ArrayBuffer,
  opts: { contentType: string; cacheControl?: string; upsert?: boolean },
) {
  const supabase = await createServiceRoleClient();
  return supabase.storage.from(BRAND.STORAGE_BUCKET).upload(path, body, {
    contentType: opts.contentType,
    cacheControl: opts.cacheControl ?? '3600',
    upsert: opts.upsert ?? false,
  });
}

/** Remove an object from the brand media bucket (rollback path). */
export async function removeMediaObject(path: string) {
  const supabase = await createServiceRoleClient();
  return supabase.storage.from(BRAND.STORAGE_BUCKET).remove([path]);
}
