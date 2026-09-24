import { z } from 'zod';

/**
 * dragdrop_puzzle — feature module schemas (architecture §6).
 *
 * Re-exports the canonical payload schema from src/lib/gifts/schemas.ts
 * plus a builder-input schema that the /create/dragdrop-puzzle form posts.
 *
 * Per architecture §6, every gift type ships its own:
 *   - builder/         sender-facing UI (route + form components)
 *   - recipient/       type-specific render under /g/[token]
 *   - components/      PuzzleBoard, PuzzlePiece, …
 *   - schemas.ts       Zod schema, imported at the type-narrow boundary
 *                      and at the builder POST path
 *
 * Phase 5 (OOP-4221) wires all four.
 */

import {
  DragdropPuzzlePayloadSchema,
  type DragdropPuzzlePayload,
} from '@/lib/gifts/schemas';

export {
  DragdropPuzzlePayloadSchema,
  type DragdropPuzzlePayload,
};

// ─── builder input ────────────────────────────────────────────────────────
// Mirrors the action's input shape. Kept here (and re-imported by the
// action) so the form, the server action, and the share-row writer all
// agree on what "valid dragdrop_puzzle draft input" means.
export const DragdropPuzzleDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  mediaId: z.string().uuid(),
  grid: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  reveal_message: z.string().trim().min(1).max(500),
});
export type DragdropPuzzleDraftInput = z.infer<typeof DragdropPuzzleDraftInputSchema>;

// ─── recipient-side shape (validated at the type-narrow boundary) ─────────
// The /g/[token]/open dispatch calls this with the raw payload right
// before rendering <DragdropPuzzleRecipientView />. Throws on mismatch —
// the dispatch page catches via .safeParse() and renders a
// "schema mismatch" placeholder.
export const DragdropPuzzleRecipientPayloadSchema = DragdropPuzzlePayloadSchema;
export type DragdropPuzzleRecipientPayload = DragdropPuzzlePayload;