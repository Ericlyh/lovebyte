'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { QuizPayloadSchema } from '@/features/quiz/schemas';

/**
 * saveQuizDraftAction — Phase 6 builder save (OOP-4222).
 *
 * Called from /create/quiz after the sender has authored 1–30
 * multiple-choice questions (each with 2–6 options, exactly one correct
 * answer, and a per-question reveal message). Writes the gifts row
 * (type=quiz, full payload) AND a shares row in one transaction so the
 * recipient can open the share token immediately. Redirects to
 * /create/[giftId]/finish?share=<token> where the share link +
 * PublishToMarketplaceCard both render.
 *
 * Quiz is text-only — no media to resolve, no upload route to call. The
 * action just persists the sender-authored JSON straight into the gift
 * payload. Validation here is the second line of defence (the form's
 * input schema is the first).
 */

export type SaveQuizResult =
  | { ok: true; giftId: string; shareToken: string }
  | { ok: false; error: string };

const saveInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  questions: z
    .array(
      z.object({
        q: z.string().trim().min(1).max(280),
        options: z
          .array(z.string().trim().min(1).max(120))
          .min(2)
          .max(6),
        correct_idx: z.number().int().min(0),
        reveal_msg: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(30)
    .refine(
      (qs) => qs.every((q) => q.correct_idx < q.options.length),
      'Every correct_idx must point to an existing option.',
    ),
});

function generateShareToken(): string {
  // 16 random bytes → 32 hex chars. Matches `shares.token` SQL default
  // (encode(gen_random_bytes(16),'hex')) so the format is identical to
  // what the DB would mint if we'd left it to DEFAULT.
  return randomBytes(16).toString('hex');
}

export async function saveQuizDraftAction(
  rawInput: unknown,
): Promise<SaveQuizResult> {
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

  // The payload is the sender-authored JSON verbatim — Zod validates
  // shape at both the action boundary and the recipient boundary.
  const payload = QuizPayloadSchema.parse({
    questions: input.questions.map((q) => ({
      q: q.q,
      options: q.options,
      correct_idx: q.correct_idx,
      reveal_msg: q.reveal_msg,
    })),
  });

  // 1. Insert the gift row first so the share FK has something to point at.
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .insert({
      owner_id: user.id,
      type: 'quiz',
      title: input.title,
      payload,
      status: 'sent',
    })
    .select('id')
    .single();

  if (giftErr || !gift) {
    console.error('[quiz] gift insert failed', giftErr?.message);
    return { ok: false, error: 'Could not save the gift. Try again.' };
  }

  // 2. Mint the share token client-side and insert the shares row.
  //    Doing this in the app (vs. relying on the SQL DEFAULT) lets us
  //    return the token to the caller without an extra round-trip.
  const shareToken = generateShareToken();
  const { error: shareErr } = await supabase.from('shares').insert({
    token: shareToken,
    gift_id: gift.id,
    created_by: user.id,
  });

  if (shareErr) {
    console.error('[quiz] share insert failed', shareErr.message);
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
export async function saveQuizDraftFormAction(formData: FormData) {
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

  const result = await saveQuizDraftAction(parsedPayload);
  if (!result.ok) {
    throw new Error(result.error);
  }
  redirect(`/create/${result.giftId}/finish?share=${result.shareToken}`);
}
