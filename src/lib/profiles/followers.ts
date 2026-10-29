import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { isUuidLike } from '@/lib/uuid';

/**
 * Follower count helpers (M-D, OOP-4276).
 *
 * `creator_follows` is public-readable (RLS `creator_follows_select_public`
 * is `using (true)`), so we can use the server client without an
 * authed session and still get the real number.
 */

/** How many followers we name in the profile's Followers section. */
const FOLLOWER_LIST_LIMIT = 24;

export type Follower = {
  id: string;
  handle: string;
  displayName: string | null;
  followedAt: string;
};

/**
 * Count of rows in `creator_follows` where `creator_id = $1`.
 *
 * Uses PostgREST's `head: true` + `count: 'exact'` so the database
 * does the aggregation and we don't pay the wire cost of returning
 * rows. Returns 0 on error — the badge is decorative, so a missing
 * count shouldn't surface a 500.
 */
export async function getFollowerCount(creatorId: string): Promise<number> {
  if (!creatorId || !/^[0-9a-f-]{36}$/i.test(creatorId)) return 0;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from('creator_follows')
    .select('follower_id', { count: 'exact', head: true })
    .eq('creator_id', creatorId);

  if (error) {
    console.error('[followers/getFollowerCount]', error.message);
    return 0;
  }
  return typeof count === 'number' ? count : 0;
}

/**
 * The people who follow a creator, newest first (OOP-6719).
 *
 * The profile's Followers section used to render a hard-coded
 * "No followers yet." whatever the real count was — the tab header had
 * the number, the body did not. This returns the actual list so the
 * section can name them.
 *
 * The embed hint `creator_follows_follower_fk` points at `profiles(id)`;
 * `profiles_public` is the anon-readable VIEW over the same rows and
 * shares its primary key, so PostgREST resolves the relationship through
 * it. `profiles_public` is the right target — `profiles` carries private
 * columns (Stripe ids, email) that must never reach a public profile.
 */
export async function getFollowers(creatorId: string): Promise<Follower[]> {
  if (!isUuidLike(creatorId)) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('creator_follows')
    .select(
      'follower_id, created_at, follower:profiles_public!creator_follows_follower_fk(id, handle, display_name)',
    )
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false })
    .limit(FOLLOWER_LIST_LIMIT);

  if (error) {
    console.error('[followers/getFollowers]', error.message);
    return [];
  }

  const rows = (data ?? []) as unknown as Array<{
    follower_id: string;
    created_at: string;
    follower:
      | { id: string; handle: string; display_name: string | null }
      | { id: string; handle: string; display_name: string | null }[]
      | null;
  }>;

  return rows.map((row) => {
    const follower = Array.isArray(row.follower) ? row.follower[0] : row.follower;
    return {
      id: row.follower_id,
      handle: follower?.handle ?? '',
      displayName: follower?.display_name ?? null,
      followedAt: row.created_at,
    };
  });
}