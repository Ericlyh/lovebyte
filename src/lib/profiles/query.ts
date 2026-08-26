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
  return (data as PublicProfile | null) ?? null;
}
