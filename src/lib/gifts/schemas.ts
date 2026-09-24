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

// ─── memory_cards (Phase 4, OOP-4219) ─────────────────────────────────────
// Source of truth: design/04-architecture/architecture.md §3 (locked shape).
//   pairs:       photo pairs the recipient matches. Each pair is two cards
//                with the same photo_url — only the caption disambiguates.
//                ≥ 3 pairs so the game has enough turns to be interesting;
//                ≤ 12 pairs keeps a 4×6 grid manageable on mobile.
//   difficulty:  affects the timer / flip window. Free-form for now —
//                the recipient view consumes the string.
//   card_back:   CSS background-image url (or color) used for the face-down
//                card. Optional — falls back to a CSS gradient.
//   music_url:   optional bg music once the recipient opens the first card.
//                Safari/iOS gate the autoplay on a user gesture so we only
//                start the audio after the first flip.
export const MemoryCardsPayloadSchema = z.object({
  pairs: z
    .array(
      z.object({
        photo_url: z.string().url(),
        caption: z.string().min(1).max(120),
      }),
    )
    .min(3, 'Need at least 3 pairs to play.')
    .max(12, 'Max 12 pairs (24 cards).')
    .refine(
      (pairs) => new Set(pairs.map((p) => p.photo_url)).size === pairs.length,
      'Each pair needs a unique photo — duplicates won’t match.',
    ),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  card_back: z.string().url().optional(),
  music_url: z.string().url().nullable().default(null),
});
export type MemoryCardsPayload = z.infer<typeof MemoryCardsPayloadSchema>;

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
