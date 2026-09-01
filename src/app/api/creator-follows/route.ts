import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/creator-follows — follow a creator (M-B step 3b, OOP-4285).
 *
 * Body: { creator_id: string (uuid) }
 * Auth: required. The server client reads the user's session from
 *       cookies; the auth.uid() call inside RLS picks the same value.
 * Effect: idempotent INSERT into creator_follows (PK = follower_id, creator_id).
 *         A duplicate INSERT is a no-op via upsert with
 *         onConflict: 'follower_id,creator_id' — the row already exists,
 *         so we just return ok: true.
 *
 * Status codes:
 *   200 { ok: true, following: true }  — followed (or already following)
 *   400 { ok: false, error }           — body missing or creator_id is not a uuid
 *   401 { ok: false, error }           — no authenticated user
 *   422 { ok: false, error }           — self-follow attempt (CHECK constraint)
 *   500 { ok: false, error }           — unexpected DB / RLS failure
 */
export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const creatorId =
    typeof body === 'object' && body !== null && 'creator_id' in body
      ? (body as { creator_id: unknown }).creator_id
      : undefined;

  if (typeof creatorId !== 'string' || !UUID_RE.test(creatorId)) {
    return NextResponse.json(
      { ok: false, error: 'creator_id must be a UUID.' },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to follow creators.' },
      { status: 401 },
    );
  }

  // Self-follow is blocked at the DB level by the CHECK constraint
  // (follower_id <> creator_id). The check is duplicated here so we
  // can return a friendly 422 instead of a Postgres 23514.
  if (user.id === creatorId) {
    return NextResponse.json(
      { ok: false, error: "You can't follow yourself." },
      { status: 422 },
    );
  }

  const { error } = await supabase
    .from('creator_follows')
    .upsert(
      { follower_id: user.id, creator_id: creatorId },
      { onConflict: 'follower_id,creator_id', ignoreDuplicates: true },
    );

  if (error) {
    // RLS or FK failure. RLS "new row violates row-level security policy"
    // would land here only for a non-self, non-FK violation — surface as
    // a 500 so we notice; we don't expect this in normal traffic.
    console.error('[api/creator-follows POST]', error.message);
    return NextResponse.json(
      { ok: false, error: 'Could not follow. Try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, following: true });
}
