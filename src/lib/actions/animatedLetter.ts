'use server';

import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import {
  AnimatedLetterDraftInputSchema,
  AnimatedLetterPayloadSchema,
} from '@/features/letter/schemas';

/**
 * saveAnimatedLetterDraftAction — sender-side builder save (OOP-6720).
 *
 * Writes the gifts row (type=animated_letter, full payload) AND a shares
 * row in one go, so the recipient can open the share token immediately.
 * Redirects to /create/[giftId]/finish?share=<token> where the share link
 * + PublishToMarketplaceCard both render.
 *
 * Why this file exists: the RECIPIENT half of the animated letter shipped
 * in Phase 3 (`/g/[token]/open` renders `<AnimatedLetter />`), but the
 * SENDER half never did. `animated_letter` was the first entry in the
 * create dropdown and its default, and it had no builder route — picking
 * it produced a draft with an empty payload that the publish action
 * refused ("This gift has no content yet. Fill out the builder first,
 * then publish."). Every creator who picked the default option could
 * never finish.
 *
 * Text-only for now: the payload schema carries an `inline_media` array
 * (photos, voice notes, music) and the recipient renderer draws it, but
 * wiring uploads into the letter is its own piece of work. We write an
 * empty array, which is what the schema's own `.default([])` produces.
 *
 * Mirrors the other builders (quiz, memory cards, …) exactly: insert the
 * gift, mint the share token in the app so the caller gets it back
 * without a second round-trip, and roll the gift back if the share
 * insert fails — an orphaned gift would show up in /u/me with no
 * shareable link.
 */

export type SaveAnimatedLetterResult =
  | { ok: true; giftId: string; shareToken: string }
  | { ok: false; error: string };

function generateShareToken(): string {
  // 16 random bytes → 32 hex chars. Matches `shares.token` SQL default
  // (encode(gen_random_bytes(16),'hex')) so the format is identical to
  // what the DB would mint if we'd left it to DEFAULT.
  return randomBytes(16).toString('hex');
}

export async function saveAnimatedLetterDraftAction(
  rawInput: unknown,
): Promise<SaveAnimatedLetterResult> {
  const parsed = AnimatedLetterDraftInputSchema.safeParse(rawInput);
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

  // Validate the payload against the SAME schema the recipient renderer
  // uses, so a letter the builder accepts is a letter the renderer can
  // draw. `inline_media` is empty — see the note above.
  const payload = AnimatedLetterPayloadSchema.parse({
    markdown: input.markdown,
    paper: input.paper,
    envelope_color: input.envelope_color,
    inline_media: [],
  });

  // 1. Insert the gift row first so the share FK has something to point at.
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .insert({
      owner_id: user.id,
      type: 'animated_letter',
      title: input.title,
      payload,
      status: 'sent',
    })
    .select('id')
    .single();

  if (giftErr || !gift) {
    console.error('[letter] gift insert failed', giftErr?.message);
    return { ok: false, error: 'Could not save the gift. Try again.' };
  }

  // 2. Mint the share token client-side and insert the shares row.
  const shareToken = generateShareToken();
  const { error: shareErr } = await supabase.from('shares').insert({
    token: shareToken,
    gift_id: gift.id,
    created_by: user.id,
  });

  if (shareErr) {
    console.error('[letter] share insert failed', shareErr.message);
    // Best-effort cleanup: remove the orphaned gift so /u/me doesn't
    // list a gift that has no shareable link.
    await supabase.from('gifts').delete().eq('id', gift.id);
    return { ok: false, error: 'Could not create the share link. Try again.' };
  }

  return { ok: true, giftId: gift.id, shareToken };
}
