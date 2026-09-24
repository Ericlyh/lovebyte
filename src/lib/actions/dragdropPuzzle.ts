'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { DragdropPuzzlePayloadSchema } from '@/features/dragdrop-puzzle/schemas';

/**
 * saveDragdropPuzzleDraftAction — Phase 5 builder save (OOP-4221).
 *
 * Called from /create/dragdrop-puzzle after the sender has uploaded one
 * photo, picked a grid size (3/4/5), and written a reveal message. Writes
 * the gifts row (type=dragdrop_puzzle, full payload) AND a shares row in
 * one transaction so the recipient can open the share token immediately.
 * Redirects to /create/[giftId]/finish?share=<token> where the share link
 * + PublishToMarketplaceCard both render.
 *
 * The photo upload itself is handled by /api/upload/photo (kind=dragdrop_puzzle)
 * — this action only takes the already-uploaded mediaId and resolves it
 * to a public URL via the gift_media table. Owner-scoped SELECT on
 * gift_media enforces that the sender can't reference another user's media.
 */

export type SaveDragdropPuzzleResult =
  | { ok: true; giftId: string; shareToken: string }
  | { ok: false; error: string };

const saveInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  mediaId: z.string().uuid(),
  grid: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  reveal_message: z.string().trim().min(1).max(500),
});

function generateShareToken(): string {
  // 16 random bytes → 32 hex chars. Matches `shares.token` SQL default
  // (encode(gen_random_bytes(16),'hex')) so the format is identical to
  // what the DB would mint if we'd left it to DEFAULT.
  return randomBytes(16).toString('hex');
}

export async function saveDragdropPuzzleDraftAction(
  rawInput: unknown,
): Promise<SaveDragdropPuzzleResult> {
  const parsed = saveInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'Sign in to save a draft.' };
  }

  // 1. Resolve mediaId → (storage_path, mime) so we can build the
  //    public URL. RLS `gift_media_all_own` ensures the user only sees
  //    their own rows.
  const { data: mediaRow, error: mediaErr } = await supabase
    .from('gift_media')
    .select('id, storage_path, mime')
    .eq('owner_id', user.id)
    .eq('id', input.mediaId)
    .maybeSingle();

  if (mediaErr) {
    console.error('[dragdropPuzzle] media lookup failed', mediaErr.message);
    return { ok: false, error: 'Could not load your photo. Try again.' };
  }
  if (!mediaRow) {
    return {
      ok: false,
      error: 'That photo is no longer available. Re-upload and try again.',
    };
  }

  // 2. Build the payload using the public URL. The bucket is private but
  //    gifts/<owner>/.../<file> is publicly readable (see migration 0001
  //    + 0004 — owner-scoped prefixes without a signed URL).
  const { data: pub } = supabase.storage
    .from('lovebyte-media')
    .getPublicUrl(mediaRow.storage_path);
  if (!pub.publicUrl) {
    return { ok: false, error: 'Could not resolve photo URL. Try again.' };
  }

  const payload = DragdropPuzzlePayloadSchema.parse({
    photo_url: pub.publicUrl,
    grid: input.grid,
    reveal_message: input.reveal_message,
  });

  // 3. Insert the gift row first so the share FK has something to point at.
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .insert({
      owner_id: user.id,
      type: 'dragdrop_puzzle',
      title: input.title,
      payload,
      status: 'sent',
    })
    .select('id')
    .single();

  if (giftErr || !gift) {
    console.error('[dragdropPuzzle] gift insert failed', giftErr?.message);
    return { ok: false, error: 'Could not save the gift. Try again.' };
  }

  // 4. Mint the share token client-side and insert the shares row.
  //    Doing this in the app (vs. relying on the SQL DEFAULT) lets us
  //    return the token to the caller without an extra round-trip.
  const shareToken = generateShareToken();
  const { error: shareErr } = await supabase.from('shares').insert({
    token: shareToken,
    gift_id: gift.id,
    created_by: user.id,
  });

  if (shareErr) {
    console.error('[dragdropPuzzle] share insert failed', shareErr.message);
    // Best-effort cleanup: remove the orphaned gift so /u/me doesn't
    // list a gift that has no shareable link.
    await supabase.from('gifts').delete().eq('id', gift.id);
    return { ok: false, error: 'Could not create the share link. Try again.' };
  }

  return { ok: true, giftId: gift.id, shareToken };
}

/**
 * Form-action variant — same logic but redirects on success so the
 * builder form's `<form action={…}>` submission Just Works without
 * any client-side JS. Throws on success because that's how
 * Next.js server-action redirects work; the surrounding <form>
 * catches the navigation.
 */
export async function saveDragdropPuzzleDraftFormAction(formData: FormData) {
  const rawJson = formData.get('payload') as string | null;
  if (!rawJson) {
    throw new Error('Missing payload.');
  }
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(rawJson);
  } catch {
    throw new Error('Malformed payload.');
  }

  const result = await saveDragdropPuzzleDraftAction(parsedPayload);
  if (!result.ok) {
    throw new Error(result.error);
  }
  redirect(`/create/${result.giftId}/finish?share=${result.shareToken}`);
}