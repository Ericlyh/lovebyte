'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Create a draft gift so the user can reach /create/[giftId]/finish and
 * mount PublishToMarketplaceCard. MVP path — no payload yet, no media yet.
 * Real per-type builders (OOP-4219..OOP-4224) will fill `payload` later.
 *
 * Wired to <CreateDraftForm /> via `useActionState`. On success we
 * `redirect()` to the finish route — Next.js's form-action response
 * machinery honours that throw reliably. On failure we return
 * `{ ok: false, error }` which the form renders below the button.
 *
 * Accepts FormData (rather than a plain object) to keep the action shape
 * consistent with the rest of the marketplace (signInAction,
 * joinWaitlistAction, save*DraftAction). (OOP-5432.)
 */
export type CreateDraftGiftResult =
  | { ok: true; giftId: string }
  | { ok: false; error: string };

const createDraftInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(100, 'Title is too long.'),
  type: z.enum([
    'memory_cards',
    'dragdrop_puzzle',
    'quiz',
    'multimedia_collage',
    'animated_letter',
  ]),
});

export async function createDraftGiftAction(
  rawInput: FormData | unknown,
): Promise<CreateDraftGiftResult> {
  const input =
    rawInput instanceof FormData
      ? {
          title: String(rawInput.get('title') ?? ''),
          type: String(rawInput.get('type') ?? ''),
        }
      : (rawInput as { title: string; type: string });

  const parsed = createDraftInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { type } = parsed.data;
  const title = parsed.data.title;

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('gifts')
    .insert({
      owner_id: user.id,
      type,
      title,
      payload: {} as Record<string, never>,
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertErr || !inserted) {
    // Surface the real cause in dev so bug reports carry actionable detail;
    // generic message in prod so we don't leak schema/constraint names.
    console.error('[draft] gift insert failed', insertErr?.message);
    const detail = insertErr?.message ?? '';
    const isDev = process.env.NODE_ENV !== 'production';
    return {
      ok: false,
      error: isDev && detail
        ? `Could not create the draft: ${detail}`
        : 'Could not create the draft right now.',
    };
  }

  revalidatePath('/create');
  redirect(`/create/${inserted.id}/finish`);
}