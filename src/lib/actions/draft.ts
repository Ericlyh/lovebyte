'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { GiftType } from '@/lib/gifts/schemas';

/**
 * Create a draft gift so the user can reach the per-type builder (or, for
 * types that have no sender-side builder, the publish card at
 * `/create/[giftId]/finish`).
 *
 * Wiring:
 *   - For types with a real builder at `/create/<type>` (memory_cards,
 *     dragdrop_puzzle, quiz, multimedia_collage — Phases 4–7, OOP-4219..
 *     OOP-4223), we redirect straight to the builder. The builder's own
 *     `save*DraftAction` writes the gifts + shares rows. This means the
 *     picker can no longer short-circuit to an empty payload — the user
 *     has to actually fill out the gift before the publish card mounts.
 *   - For `animated_letter` (no sender-side builder yet), we keep the
 *     MVP path: create the draft with an empty payload and route to
 *     `/create/[id]/finish` where PublishToMarketplaceCard lives.
 *     `publishToMarketplaceAction` has a guard that rejects empty
 *     payloads so this path cannot produce a broken listing.
 *
 * Wired to <CreateDraftForm /> via `useActionState`. On success we
 * `redirect()` — Next.js's form-action response machinery honours that
 * throw reliably. On failure we return `{ ok: false, error }` which the
 * form renders below the button.
 *
 * Accepts FormData (rather than a plain object) to keep the action shape
 * consistent with the rest of the marketplace (signInAction,
 * joinWaitlistAction, save*DraftAction). (OOP-5432.)
 */
export type CreateDraftGiftResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

/**
 * Types that ship with a builder route at `/create/<type>`. Pickers
 * route these straight to the builder; everything else falls through
 * to the legacy `/create/[id]/finish` path.
 */
const BUILDER_ROUTE: Partial<Record<GiftType, string>> = {
  memory_cards: '/create/memory-cards',
  dragdrop_puzzle: '/create/dragdrop-puzzle',
  quiz: '/create/quiz',
  multimedia_collage: '/create/multimedia-collage',
};

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

  // For types with a real builder route, skip the empty-draft step and
  // route straight into the builder. The builder's own save*DraftAction
  // will write the gifts + shares rows when the sender actually finishes
  // authoring the gift. (Title carry-over across the picker→builder
  // boundary is intentionally not implemented — it would require reading
  // `searchParams` in four page.tsx + three form.tsx files, and the user
  // can retype a 100-char title faster than we can maintain that wiring.)
  const builderRoute = BUILDER_ROUTE[type];
  if (builderRoute) {
    revalidatePath('/create');
    redirect(builderRoute);
  }

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