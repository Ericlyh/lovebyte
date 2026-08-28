import 'server-only';
import { postgrest } from '@/lib/supabase/anon';

/**
 * Public profile shape exposed by the `profiles_public` view.
 * The view deliberately omits PII (`avatar_url`, future `email`/`phone`,
 * any column the user might want to keep private). See
 * `supabase/migrations/0002_marketplace_v2.sql` for the projection.
 */
export type PublicProfile = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_media_id: string | null;
  bio: string | null;
  links: unknown; // jsonb — narrowed at the call site
  created_at: string;
};

/**
 * Look up a creator by handle.
 *
 * Reads through `profiles_public` (anon-SELECT). Returns `null` if the
 * handle doesn't exist; the caller decides between `notFound()` (page)
 * and a 404 response (route handler).
 *
 * PostgREST note: with `limit=1` a missing row returns `[]` (empty
 * array), NOT `null`. We unwrap that here so callers get a single
 * nullable row, not an array.
 *
 * Note: this does NOT return collection items. That's M-C's job —
 * `gifts` rows with `is_listed = true` for the creator. The /u/[handle]
 * page renders an empty Collection tab until M-C ships.
 */
export async function getProfileByHandle(
  handle: string,
): Promise<PublicProfile | null> {
  const { data, error } = await postgrest<PublicProfile>('profiles_public', {
    select: 'id, handle, display_name, avatar_media_id, bio, links, created_at',
    filters: { handle },
    limitToOne: true,
  });

  if (error) {
    // Log + bail. Don't surface the raw error to the visitor — the page
    // is anon-readable so a 500 here usually means the project's RLS
    // regressed, not that the handle is wrong.
    console.error('[getProfileByHandle] postgrest error', error);
    return null;
  }
  if (data == null) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

/**
 * Look up the *current* handle for a row that used to belong to the
 * given (old) handle. Returns `null` if no history row matches — the
 * caller treats that as a 404.
 *
 * Used by `/u/[handle]/page.tsx` to issue a permanent redirect when a
 * visitor lands on an old handle URL after the creator has renamed.
 * Part C of the OOP-4284 reviewed flow.
 *
 * Reads `handle_history.old_handle` (UNIQUE index → O(1) lookup).
 * RLS: the table is anon-SELECT-enabled; handles are public via
 * profiles_public so there's no privacy concern.
 */
export async function getRedirectForOldHandle(
  oldHandle: string,
): Promise<{ newHandle: string } | null> {
  const { data, error } = await postgrest<{ new_handle: string }>('handle_history', {
    select: 'new_handle',
    filters: { old_handle: oldHandle },
    limitToOne: true,
  });
  if (error) {
    console.error('[getRedirectForOldHandle] postgrest error', error);
    return null;
  }
  if (data == null) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.new_handle ? { newHandle: row.new_handle } : null;
}
