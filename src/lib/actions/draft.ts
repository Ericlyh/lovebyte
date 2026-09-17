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
 * Returns `{ ok: true, giftId }` then redirects to the finish route.
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
  rawInput: unknown,
): Promise<CreateDraftGiftResult> {
  const parsed = createDraftInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { title, type } = parsed.data;

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
    console.error('[draft] gift insert failed', insertErr?.message);
    return { ok: false, error: 'Could not create the draft right now.' };
  }

  revalidatePath('/create');
  redirect(`/create/${inserted.id}/finish`);
}
