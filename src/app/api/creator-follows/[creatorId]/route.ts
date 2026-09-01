import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * DELETE /api/creator-follows/[creatorId] — unfollow a creator
 * (M-B step 3b, OOP-4285).
 *
 * Auth: required. The RLS policy `creator_follows_delete_own` already
 * constrains the DELETE to `auth.uid() = follower_id`, so a user can
 * only delete their own follow row — even if they hand-craft a request
 * with a different follower_id, the server client filters on the
 * session user and Postgres will refuse the row removal.
 *
 * Idempotent: deleting a non-existent row is treated as success (a
 * double-click shouldn't surface an error). PostgREST returns the
 * affected-row count via Content-Range / "rows"; we don't care about
 * the count, so we just check for errors.
 *
 * Status codes:
 *   200 { ok: true, following: false }  — unfollowed (or wasn't following)
 *   400 { ok: false, error }            — creatorId path param is not a uuid
 *   401 { ok: false, error }            — no authenticated user
 *   500 { ok: false, error }            — unexpected DB / RLS failure
 */
export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ creatorId: string }> },
) {
  const { creatorId } = await context.params;

  if (!UUID_RE.test(creatorId)) {
    return NextResponse.json(
      { ok: false, error: 'creatorId must be a UUID.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to unfollow creators.' },
      { status: 401 },
    );
  }

  // follower_id is set by RLS from auth.uid() — we don't pass it in
  // the body. The server client also can't bypass the policy without
  // the service role key, so this delete is correctly constrained.
  const { error } = await supabase
    .from('creator_follows')
    .delete()
    .eq('creator_id', creatorId)
    .eq('follower_id', user.id);

  if (error) {
    console.error('[api/creator-follows DELETE]', error.message);
    return NextResponse.json(
      { ok: false, error: 'Could not unfollow. Try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, following: false });
}
