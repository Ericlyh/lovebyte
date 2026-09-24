import { z } from 'zod';

/**
 * memory_cards — feature module schemas (architecture §6).
 *
 * Re-exports the canonical payload schema from src/lib/gifts/schemas.ts
 * plus a builder-input schema that the /create/memory-cards form posts.
 *
 * Per architecture §6, every gift type lives under src/features/<type>/
 * and ships its own:
 *   - builder/         sender-facing UI (route + form components)
 *   - recipient/       type-specific render under /g/[token]
 *   - components/      Card, CardGrid, MatchedPairs, etc.
 *   - schemas.ts       Zod schema, imported at the type-narrow boundary
 *                      and at the builder POST path
 *
 * Phase 4 (OOP-4219) wires all four.
 */

import {
  MemoryCardsPayloadSchema,
  type MemoryCardsPayload,
} from '@/lib/gifts/schemas';

export {
  MemoryCardsPayloadSchema,
  type MemoryCardsPayload,
};

// ─── builder input ────────────────────────────────────────────────────────
// Mirrors the action's input shape. Kept here (and re-imported by the
// action) so the form, the server action, and the share-row writer all
// agree on what "valid memory_cards draft input" means.
export const MemoryCardsDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  pairs: z
    .array(
      z.object({
        mediaId: z.string().uuid(),
        caption: z.string().trim().min(1).max(120),
      }),
    )
    .min(3, 'Add at least 3 pairs.')
    .max(12, 'Max 12 pairs.'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  card_back: z.string().url().optional(),
  music_url: z.string().url().nullable().optional(),
});
export type MemoryCardsDraftInput = z.infer<typeof MemoryCardsDraftInputSchema>;

// ─── recipient-side shape (validated at the type-narrow boundary) ─────────
// The /g/[token]/open dispatch calls this with the raw payload right
// before rendering <MemoryCardsRecipientView />. Throws on mismatch —
// the dispatch page catches via .safeParse() and renders a
// "schema mismatch" placeholder.
export const MemoryCardsRecipientPayloadSchema = MemoryCardsPayloadSchema;
export type MemoryCardsRecipientPayload = MemoryCardsPayload;
