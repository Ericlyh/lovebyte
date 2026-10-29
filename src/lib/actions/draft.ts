'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { GiftTypeSchema } from '@/lib/gifts/schemas';
import { GIFT_BUILDER_ROUTES } from '@/lib/gifts/types';

/**
 * Create a draft gift so the user can reach the per-type builder.
 *
 * Wiring: EVERY gift type has a builder route at `/create/<type>`, so we
 * always redirect straight to the builder. The builder's own
 * `save*DraftAction` writes the gifts + shares rows. This means the
 * picker can no longer short-circuit to an empty payload — the user has
 * to actually fill out the gift before the publish card mounts.
 *
 * The route map lives in `src/lib/gifts/types.ts` and is shared with
 * the picker, so the two cannot drift (OOP-6720). It used to be a
 * `Partial<Record<GiftType, string>>` local to this file, which let
 * `animated_letter` — the picker's DEFAULT — ship with no builder at
 * all: the creator picked it, got a draft with an empty payload, and
 * the publish action refused the gift ("This gift has no content yet").
 * The map is now total, so adding a type without a builder is a type
 * error rather than a silent dead end.
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

const createDraftInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(100, 'Title is too long.'),
  type: GiftTypeSchema,
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

  // Route straight into the builder. The builder's own save*DraftAction
  // will write the gifts + shares rows when the sender actually finishes
  // authoring the gift, so no empty-payload draft is ever created.
  // (Title carry-over across the picker→builder boundary is intentionally
  // not implemented — it would require reading `searchParams` in six
  // page.tsx + form.tsx files, and the user can retype a 100-char title
  // faster than we can maintain that wiring.)
  revalidatePath('/create');
  redirect(GIFT_BUILDER_ROUTES[type]);
}