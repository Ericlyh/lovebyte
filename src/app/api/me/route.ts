import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/me — current auth state, for client components.
 *
 * Used by the FollowButton on /u/[handle] to decide between a "Sign in
 * to follow" link (anon) and the toggle button (authed). The server
 * client is cookie-based, so it reads whatever session the user's
 * browser is currently carrying.
 *
 * Returns the minimal shape the UI needs — no PII, no profile data.
 * Keep it small: this endpoint fires on every /u/[handle] page load.
 */
export const runtime = 'nodejs';

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  return NextResponse.json(
    { authed: Boolean(user), userId: user?.id ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
