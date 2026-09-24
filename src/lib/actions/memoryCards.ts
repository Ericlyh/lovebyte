'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { MemoryCardsPayloadSchema } from '@/features/memory-cards/schemas';

/**
 * saveMemoryCardsDraftAction — Phase 4 builder save (OOP-4219).
 *
 * Called from /create/memory-cards after the sender has uploaded their
 * photo pairs. Writes the gifts row (type=memory_cards, full payload) AND
 * a shares row in one transaction so the recipient can open the share
 * token immediately. Redirects to /create/[giftId]/finish where the user
 * either copies the share link or publishes to the marketplace.
 *
 * The photo upload itself is handled by /api/upload/photo — this action
 * only takes already-uploaded mediaIds and resolves them to public URLs
 * via the gift_media table. Owner-scoped SELECT on gift_media enforces
 * that the sender can't reference another user's media.
 */

export type SaveMemoryCardsResult =
  | { ok: true; giftId: string; shareToken: string }
  | { ok: false; error: string };

const saveInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  pairs: z
    .array(
      z.object({
        mediaId: z.string().uuid(),
        caption: z.string().trim().min(1).max(120),
      }),
    )
    .min(3)
    .max(12),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  card_back: z.string().url().optional(),
  music_url: z.string().url().nullable().optional(),
});

function generateShareToken(): string {
  // 16 random bytes → 32 hex chars. Matches `shares.token` SQL default
  // (encode(gen_random_bytes(16),'hex')) so the format is identical to
  // what the DB would mint if we'd left it to DEFAULT.
  return randomBytes(16).toString('hex');
}

export async function saveMemoryCardsDraftAction(
  rawInput: unknown,
): Promise<SaveMemoryCardsResult> {
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

  // 1. Resolve every mediaId → (storage_path, mime) so we can build
  //    public URLs. RLS `gift_media_all_own` ensures the user only
  //    sees their own rows.
  const mediaIds = input.pairs.map((p) => p.mediaId);
  const { data: mediaRows, error: mediaErr } = await supabase
    .from('gift_media')
    .select('id, storage_path, mime')
    .eq('owner_id', user.id)
    .in('id', mediaIds);

  if (mediaErr) {
    console.error('[memoryCards] media lookup failed', mediaErr.message);
    return { ok: false, error: 'Could not load your photos. Try again.' };
  }
  const byId = new Map((mediaRows ?? []).map((m) => [m.id, m]));
  const missing = mediaIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: 'One or more photos are no longer available. Re-upload and try again.',
    };
  }

  // 2. Build the payload using public URLs. The bucket is private but
  //    gift_media/<owner>/.../<file> is publicly readable (see migration
  //    0001 + 0004 — owner-scoped prefixes without a signed URL).
  const pairs = input.pairs.map((p) => {
    const media = byId.get(p.mediaId)!;
    const { data: pub } = supabase.storage
      .from('lovebyte-media')
      .getPublicUrl(media.storage_path);
    return { photo_url: pub.publicUrl, caption: p.caption };
  });

  const payload = MemoryCardsPayloadSchema.parse({
    pairs,
    difficulty: input.difficulty,
    card_back: input.card_back,
    music_url: input.music_url ?? null,
  });

  // 3. Insert the gift row first so the share FK has something to point at.
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .insert({
      owner_id: user.id,
      type: 'memory_cards',
      title: input.title,
      payload,
      status: 'sent',
    })
    .select('id')
    .single();

  if (giftErr || !gift) {
    console.error('[memoryCards] gift insert failed', giftErr?.message);
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
    console.error('[memoryCards] share insert failed', shareErr.message);
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
export async function saveMemoryCardsDraftFormAction(formData: FormData) {
  const rawPairs = formData.getAll('pairs') as string[];
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
  void rawPairs; // pairs are encoded inside the JSON payload as mediaIds

  const result = await saveMemoryCardsDraftAction(parsedPayload);
  if (!result.ok) {
    throw new Error(result.error);
  }
  redirect(`/create/${result.giftId}/finish?share=${result.shareToken}`);
}
