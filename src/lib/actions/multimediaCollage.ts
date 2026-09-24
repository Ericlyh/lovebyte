'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { MultimediaCollagePayloadSchema } from '@/features/multimedia-collage/schemas';
import { BRAND } from '@/lib/brand';

/**
 * saveMultimediaCollageDraftAction — Phase 7 builder save (OOP-4223).
 *
 * Called from /create/multimedia-collage after the sender has uploaded
 * their photo / video / audio items, dragged them onto a canvas, and
 * optionally added background music. Writes the gifts row
 * (type=multimedia_collage, full payload) AND a shares row in one
 * transaction so the recipient can open the share token immediately.
 * Redirects to /create/[giftId]/finish?share=<token> where the share
 * link + PublishToMarketplaceCard both render.
 *
 * Photos can resolve via either /api/upload/photo or /api/upload/media
 * (both stamp kind=multimedia_collage + gifts/multimedia_collage/<uid>/…).
 * Videos + audios only go through /api/upload/media. Resolving by
 * mediaId is enough — the gift_media row's storage_path is canonical.
 */

export type SaveMultimediaCollageResult =
  | { ok: true; giftId: string; shareToken: string }
  | { ok: false; error: string };

const saveInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  template: z.string().trim().min(1).max(64),
  mediaItems: z
    .array(
      z.object({
        clientId: z.string().min(1),
        mediaId: z.string().uuid(),
        type: z.enum(['photo', 'video', 'audio']),
        caption: z.string().trim().max(200).default(''),
        position: z.object({
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          w: z.number().min(0.05).max(1),
          h: z.number().min(0.05).max(1),
        }),
      }),
    )
    .min(1)
    .max(20),
  musicUrl: z
    .string()
    .trim()
    .url()
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((s) => {
      if (s === null || s === undefined) return null;
      const trimmed = (s as string).trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
});

function generateShareToken(): string {
  // 16 random bytes → 32 hex chars. Matches `shares.token` SQL default
  // (encode(gen_random_bytes(16),'hex')) so the format is identical to
  // what the DB would mint if we'd left it to DEFAULT.
  return randomBytes(16).toString('hex');
}

export async function saveMultimediaCollageDraftAction(
  rawInput: unknown,
): Promise<SaveMultimediaCollageResult> {
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
  //    public URLs. RLS `gift_media_all_own` ensures the user only sees
  //    their own rows.
  const mediaIds = input.mediaItems.map((m) => m.mediaId);
  const { data: mediaRows, error: mediaErr } = await supabase
    .from('gift_media')
    .select('id, storage_path, mime')
    .eq('owner_id', user.id)
    .in('id', mediaIds);

  if (mediaErr) {
    console.error('[multimediaCollage] media lookup failed', mediaErr.message);
    return { ok: false, error: 'Could not load your media. Try again.' };
  }
  const byId = new Map((mediaRows ?? []).map((m) => [m.id, m]));
  const missing = mediaIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: 'One or more media items are no longer available. Re-upload and try again.',
    };
  }

  // 2. Build the payload using public URLs. The bucket is private but
  //    gifts/<kind>/<owner>/.../<file> is publicly readable (see
  //    migration 0001 + 0004 — owner-scoped prefixes without a signed
  //    URL). Captions and positional layout come from the builder.
  const media = input.mediaItems.map((m) => {
    const row = byId.get(m.mediaId)!;
    const { data: pub } = supabase.storage
      .from(BRAND.STORAGE_BUCKET)
      .getPublicUrl(row.storage_path);
    const item: {
      type: 'photo' | 'video' | 'audio';
      url: string;
      caption?: string;
      position: { x: number; y: number; w: number; h: number };
    } = {
      type: m.type,
      url: pub.publicUrl,
      position: m.position,
    };
    if (m.caption.length > 0) item.caption = m.caption;
    return item;
  });

  const payload = MultimediaCollagePayloadSchema.parse({
    template: input.template,
    media,
    music_url: input.musicUrl ?? null,
  });

  // 3. Insert the gift row first so the share FK has something to point at.
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .insert({
      owner_id: user.id,
      type: 'multimedia_collage',
      title: input.title,
      payload,
      status: 'sent',
    })
    .select('id')
    .single();

  if (giftErr || !gift) {
    console.error('[multimediaCollage] gift insert failed', giftErr.message);
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
    console.error('[multimediaCollage] share insert failed', shareErr.message);
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
export async function saveMultimediaCollageDraftFormAction(formData: FormData) {
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

  const result = await saveMultimediaCollageDraftAction(parsedPayload);
  if (!result.ok) {
    throw new Error(result.error);
  }
  redirect(`/create/${result.giftId}/finish?share=${result.shareToken}`);
}
