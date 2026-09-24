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

// ─── dragdrop_puzzle (Phase 5, OOP-4221) ───────────────────────────────────
// Source of truth: design/04-architecture/architecture.md §3 (locked shape).
//   photo_url:      one photo the sender uploads; the recipient gats to
//                   reconstruct it.
//   grid:           3×3 / 4×4 / 5×5. Determines piece count (9 / 16 / 25).
//   reveal_message: shown when the recipient completes the puzzle.
//                   Acts as the gift's "message in a bottle".
export const DragdropPuzzlePayloadSchema = z.object({
  photo_url: z.string().url(),
  grid: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  reveal_message: z.string().min(1).max(500),
});
export type DragdropPuzzlePayload = z.infer<typeof DragdropPuzzlePayloadSchema>;

// ─── quiz (Phase 6, OOP-4222) ──────────────────────────────────────────────
// Source of truth: design/04-architecture/architecture.md §3 (locked shape).
//   questions[]:    sender-authored multiple-choice questions.
//     q:            question text. ≥ 1 char.
//     options:      2..6 answer choices, each 1..120 chars. Recipient picks.
//     correct_idx:  index into `options` for the right answer. Validated
//                   below so out-of-range indices fail fast at the boundary.
//     reveal_msg:   shown after the recipient answers (correct or not).
//                   Acts as the "message in a bottle" — the gift's payoff.
//   ≥ 1 question keeps a quiz a quiz; ≤ 30 keeps the recipient's session
//   reasonable (≈10 min at 20s per question).
export const QuizPayloadSchema = z.object({
  questions: z
    .array(
      z.object({
        q: z.string().min(1).max(280),
        options: z
          .array(z.string().min(1).max(120))
          .min(2, 'Each question needs at least 2 options.')
          .max(6, 'Max 6 options per question.'),
        correct_idx: z.number().int().min(0),
        reveal_msg: z.string().min(1).max(500),
      }),
    )
    .min(1, 'Add at least one question.')
    .max(30, 'Max 30 questions per quiz.')
    .refine(
      (qs) => qs.every((q) => q.correct_idx < q.options.length),
      'Every correct_idx must point to an existing option.',
    ),
});
export type QuizPayload = z.infer<typeof QuizPayloadSchema>;

// ─── multimedia_collage (Phase 7, OOP-4223) ────────────────────────────────
// Source of truth: design/04-architecture/architecture.md §3 + §7 (locked).
//   template:   canvas template id chosen by the sender (e.g.
//               'polaroid-wall', 'timeline', 'magazine'). Free-form for
//               now — the recipient view treats unknown templates as a
//               fallback render.
//   media:      ordered list of items placed on the canvas. Each item
//               carries its own positional {x, y, w, h} in 0..1 canvas
//               percentages so the canvas scales without the sender
//               having to pick pixel coordinates. The recipient view
//               stretches them into the available canvas size.
//     type:     'photo' | 'video' | 'audio'.
//     url:      public Storage URL (or signed URL — same shape).
//     caption:  short optional caption that overlays the item.
//               Trims at 200 chars — long enough for a quote, short
//               enough to stay legible on a phone.
//   music_url:  optional background music. Playback is gated on a user
//               gesture (Safari/iOS autoplay) and starts via MusicToggle.
//
// Storage limits (architecture §7 / §11 #3):
//   - photo: ≤ 5 MB uploaded via /api/upload/photo?kind=multimedia_collage.
//   - video: ≤ 50 MB uploaded via /api/upload/media (Supabase Storage
//            handles short clips fine; clips > 50 MB switch to Mux by
//            policy, but that's out of scope for the MVP — sender sees
//            an explicit error rather than silent fallback).
//   - audio: ≤ 25 MB uploaded via /api/upload/media (matches i18n hint).
export const MultimediaMediaKindSchema = z.enum(['photo', 'video', 'audio']);
export type MultimediaMediaKind = z.infer<typeof MultimediaMediaKindSchema>;

// Per-canvas percentages. 0..1 inclusive.
const PercentSchema = z.number().min(0).max(1);

const MultimediaMediaPositionSchema = z.object({
  x: PercentSchema,
  y: PercentSchema,
  w: PercentSchema,
  h: PercentSchema,
});

export const MultimediaMediaItemSchema = z
  .object({
    type: MultimediaMediaKindSchema,
    url: z.string().min(1, 'Each media item needs a URL.'),
    caption: z.string().max(200).optional(),
    position: MultimediaMediaPositionSchema,
  })
  .refine(
    (m) => m.position.w > 0 && m.position.h > 0,
    'Media items need a positive size on the canvas.',
  );
export type MultimediaMediaItem = z.infer<typeof MultimediaMediaItemSchema>;

export const MultimediaCollagePayloadSchema = z.object({
  template: z.string().trim().min(1).max(64),
  media: z
    .array(MultimediaMediaItemSchema)
    .min(1, 'Add at least one photo, video, or audio item.')
    .max(20, 'Max 20 media items per collage.'),
  music_url: z.string().url().nullable().default(null),
});
export type MultimediaCollagePayload = z.infer<typeof MultimediaCollagePayloadSchema>;

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
