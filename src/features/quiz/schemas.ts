import { z } from 'zod';

/**
 * quiz — feature module schemas (architecture §6).
 *
 * Re-exports the canonical payload schema from src/lib/gifts/schemas.ts
 * plus a builder-input schema that the /create/quiz form posts.
 *
 * Per architecture §6, every gift type ships its own:
 *   - builder/         sender-facing UI (route + form components)
 *   - recipient/       type-specific render under /g/[token]
 *   - components/      Question, OptionList, ScoreBoard
 *   - schemas.ts       Zod schema, imported at the type-narrow boundary
 *                      and at the builder POST path
 *
 * Phase 6 (OOP-4222) wires all four. Quiz is text-only — no photo
 * upload — so the /api/upload/photo route doesn't need a `quiz` kind.
 */

import {
  QuizPayloadSchema,
  type QuizPayload,
} from '@/lib/gifts/schemas';

export {
  QuizPayloadSchema,
  type QuizPayload,
};

// ─── builder input ────────────────────────────────────────────────────────
// Mirrors the action's input shape. Kept here (and re-imported by the
// action) so the form, the server action, and the share-row writer all
// agree on what "valid quiz draft input" means.
export const QuizDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  questions: z
    .array(
      z.object({
        q: z.string().trim().min(1).max(280),
        options: z
          .array(z.string().trim().min(1).max(120))
          .min(2, 'Each question needs at least 2 options.')
          .max(6, 'Max 6 options per question.'),
        correct_idx: z.number().int().min(0),
        reveal_msg: z.string().trim().min(1).max(500),
      }),
    )
    .min(1, 'Add at least one question.')
    .max(30, 'Max 30 questions per quiz.')
    .refine(
      (qs) => qs.every((q) => q.correct_idx < q.options.length),
      'Every correct_idx must point to an existing option.',
    ),
});
export type QuizDraftInput = z.infer<typeof QuizDraftInputSchema>;

// ─── recipient-side shape (validated at the type-narrow boundary) ─────────
// The /g/[token]/open dispatch calls this with the raw payload right
// before rendering <QuizGame />. Throws on mismatch — the dispatch
// page catches via .safeParse() and renders a "schema mismatch"
// placeholder.
export const QuizRecipientPayloadSchema = QuizPayloadSchema;
export type QuizRecipientPayload = QuizPayload;
