import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Follower count helpers (M-D, OOP-4276).
 *
 * `creator_follows` is public-readable (RLS `creator_follows_select_public`
 * is `using (true)`), so we can use the server client without an
 * authed session and still get the real number.
 */

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