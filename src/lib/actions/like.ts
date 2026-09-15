'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Like toggle action (M-C, OOP-4275).
 *
 * Idempotent flip on `gift_likes (profile_id, gift_id)`. We don't expose
 * a separate unlike action — the client calls `toggleLikeAction` and the
 * server decides whether to insert or delete based on the current state.
 *
 * Auth gate: returns `{ ok: false, error: 'unauthenticated' }` if no
 * session; the client renders a "Sign in to like" link. We deliberately
 * don't redirect to /login from a server action called by a useTransition
 * — redirect would tear down the listing page and break the like state
 * the user was just looking at.
 *
 * Note: full like-button UX (notifications, animated heart, optimistic
 * reply counts) lands in M-D (OOP-4276). M-C ships the minimum needed
 * to make the acceptance test pass: anon-friendly count + an authed
 * toggle that updates the same number.
 */

const inputSchema = z.object({
  giftId: z.string().uuid('giftId must be a UUID.'),
});

export type ToggleLikeResult =
  | { ok: true; liked: boolean; likeCount: number }
  | { ok: false; error: string };

export async function toggleLikeAction(rawInput: unknown): Promise<ToggleLikeResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { giftId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // RLS: insert/delete on gift_likes is gated by `auth.uid() = profile_id`
  // — both branches run as the caller.
  const { data: existing, error: existingErr } = await supabase
    .from('gift_likes')
    .select('profile_id')
    .eq('profile_id', user.id)
    .eq('gift_id', giftId)
    .maybeSingle();

  if (existingErr) {
    console.error('[likes/toggle] read failed', existingErr.message);
    return { ok: false, error: 'Could not update your like right now.' };
  }

  let liked: boolean;
  if (existing) {
    const { error: delErr } = await supabase
      .from('gift_likes')
      .delete()
      .eq('profile_id', user.id)
      .eq('gift_id', giftId);
    if (delErr) {
      console.error('[likes/toggle] delete failed', delErr.message);
      return { ok: false, error: 'Could not update your like right now.' };
    }
    liked = false;
  } else {
    const { error: insErr } = await supabase
      .from('gift_likes')
      .insert({ profile_id: user.id, gift_id: giftId });
    if (insErr) {
      console.error('[likes/toggle] insert failed', insErr.message);
      return { ok: false, error: 'Could not update your like right now.' };
    }
    liked = true;
  }

  // Recount via the SQL function so we return a fresh number rather than
  // computing `count ± 1` (a concurrent like would desync the displayed
  // number).
  let likeCount = 0;
  try {
    const { data: countData } = await supabase.rpc('gift_like_count', { gift_id: giftId });
    likeCount = typeof countData === 'number' ? countData : Number(countData ?? 0);
  } catch {
    likeCount = liked ? 1 : 0;
  }

  // Refresh the listing page so the SSR number on next render matches.
  // The client's optimistic update handles the in-flight display; this
  // catches the case where the user reloads after liking.
  revalidatePath(`/l/${giftId}`);

  return { ok: true, liked, likeCount };
}
