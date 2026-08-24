import { z } from 'zod';

/**
 * Zod schemas for gifts.payload — one per gift type.
 *
 * Source of truth: design/04-architecture/architecture.md §3.
 * The shapes here match the SQL JSONB comments in
 * supabase/migrations/0001_initial_schema.sql. Used at two boundaries:
 *
 *   1. The Supabase SELECT path — validate before passing to a
 *      <RecipientView /> (architecture §6 feature module pattern).
 *   2. The future builder POST path — validate user input before INSERT.
 *
 * Only `animated_letter` is shipped in this child issue (Phase 3).
 * The other four types are stubbed here so the schema map compiles;
 * they will be filled in by their respective Phase 4–8 sub-issues.
 */

export const GiftTypeSchema = z.enum([
  'memory_cards',
  'dragdrop_puzzle',
  'quiz',
  'multimedia_collage',
  'animated_letter',
]);
export type GiftType = z.infer<typeof GiftTypeSchema>;

// ─── animated_letter ──────────────────────────────────────────────────────
export const AnimatedLetterPayloadSchema = z.object({
  markdown: z.string().min(1),
  paper: z.enum(['cream', 'kraft', 'lined']).default('cream'),
  envelope_color: z.enum(['honey', 'blush', 'sky']).default('honey'),
  inline_media: z
    .array(
      z.object({
        type: z.enum(['photo', 'voice', 'music', 'animation']),
        url: z.string().url(),
        caption: z.string().optional(),
      }),
    )
    .default([]),
});
export type AnimatedLetterPayload = z.infer<typeof AnimatedLetterPayloadSchema>;

// ─── shared envelope (returned by the fetcher for any gift type) ──────────
export const RecipientEnvelopeSchema = z.object({
  shareToken: z.string().min(1),
  giftType: GiftTypeSchema,
  senderName: z.string(),
  sentAtIso: z.string(),                 // ISO; page formats relative time
  coverText: z.string().optional(),      // short quote shown on the envelope
  // Type-specific payload, validated by the matching feature module:
  payload: z.unknown(),
});
export type RecipientEnvelope = z.infer<typeof RecipientEnvelopeSchema>;
