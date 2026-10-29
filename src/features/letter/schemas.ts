import { z } from 'zod';

/**
 * animated_letter — feature module schemas (architecture §6).
 *
 * Re-exports the canonical payload schema from src/lib/gifts/schemas.ts
 * plus a builder-input schema the /create/animated-letter form posts.
 *
 * The recipient renderer (`/g/[token]/open` → `<AnimatedLetter />`) and
 * this module are the two ends of the same contract: the sender writes
 * here, the recipient reads there. The payload schema is shared, so a
 * letter the builder accepts is a letter the renderer can draw.
 *
 * Phase 3 shipped the RECIPIENT half only — there was no sender-side
 * builder, so `animated_letter` was the one gift type a creator could
 * pick but never finish (OOP-6720). This file is the sender-side half.
 *
 * Media: the payload schema carries an `inline_media` array (photos,
 * voice notes, music) and the renderer draws it, but the builder is
 * TEXT-ONLY for now — inline media needs the upload + transcription
 * pipeline, which is its own piece of work. The builder writes an
 * empty `inline_media` array, which is exactly what the schema's
 * `.default([])` produces, so the renderer treats it as "no media"
 * rather than "schema mismatch".
 */

import {
  AnimatedLetterPayloadSchema,
  type AnimatedLetterPayload,
} from '@/lib/gifts/schemas';

export {
  AnimatedLetterPayloadSchema,
  type AnimatedLetterPayload,
};

/** The longest letter body the builder accepts. */
export const LETTER_MAX_MARKDOWN = 5000;

// ─── builder input ────────────────────────────────────────────────────────
// Mirrors the action's input shape. Kept here (and re-imported by the
// action) so the form, the server action, and the share-row writer all
// agree on what "valid letter draft input" means.
export const AnimatedLetterDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  markdown: z.string().trim().min(1).max(LETTER_MAX_MARKDOWN),
  paper: z.enum(['cream', 'kraft', 'lined']).default('cream'),
  envelope_color: z.enum(['honey', 'blush', 'sky']).default('honey'),
});
export type AnimatedLetterDraftInput = z.infer<
  typeof AnimatedLetterDraftInputSchema
>;

// ─── recipient-side shape (validated at the type-narrow boundary) ─────────
export const AnimatedLetterRecipientPayloadSchema = AnimatedLetterPayloadSchema;
export type AnimatedLetterRecipientPayload = AnimatedLetterPayload;
