import { z } from 'zod';

/**
 * multimedia_collage — feature module schemas (architecture §6).
 *
 * Re-exports the canonical payload schema from src/lib/gifts/schemas.ts
 * plus a builder-input schema that the /create/multimedia-collage form
 * posts. Mirrors the Phase 6 (quiz) layout so the rest of the codebase
 * (fetcher dispatch, recipient switch) has the same shape.
 *
 * Per architecture §6, every gift type ships its own:
 *   - builder/         sender-facing UI (route + form components)
 *   - recipient/       type-specific render under /g/[token]
 *   - components/      Canvas, MediaItem, MusicToggle (this milestone)
 *   - schemas.ts       Zod schema, imported at the type-narrow boundary
 *                      and at the builder POST path
 *
 * Phase 7 (OOP-4223) wires all four. multimedia_collage mixes photos,
 * videos, and audios — uploads go through /api/upload/media (new route)
 * and /api/upload/photo (existing route, kind=multimedia_collage).
 */

import {
  MultimediaCollagePayloadSchema,
  MultimediaMediaItemSchema,
  MultimediaMediaKindSchema,
  type MultimediaCollagePayload,
  type MultimediaMediaItem,
  type MultimediaMediaKind,
} from '@/lib/gifts/schemas';

export {
  MultimediaCollagePayloadSchema,
  MultimediaMediaItemSchema,
  MultimediaMediaKindSchema,
  type MultimediaCollagePayload,
  type MultimediaMediaItem,
  type MultimediaMediaKind,
};

// ─── builder input ────────────────────────────────────────────────────────
// Mirrors the action's input shape. The form posts { title, template,
// mediaItems, musicUrl } and the action resolves each mediaId → public URL,
// converts positions to the canonical {x,y,w,h} 0..1 percentages, and
// stores the result as MultimediaCollagePayload.
//
// Per-item state:
//   mediaId:     string from /api/upload/(photo|media) — used by the action
//                to look up the URL via gift_media + Storage.
//   type:        which kind produced the media (drives the input accept attr).
//   caption:     short overlay copy; recipient-side renders under the item.
//   position:    same shape as the canonical payload position; client
//                translates drag deltas → 0..1 percentages.
export const MultimediaCollageBuilderItemSchema = z.object({
  clientId: z.string().min(1),
  mediaId: z.string().uuid(),
  type: MultimediaMediaKindSchema,
  caption: z.string().trim().max(200).default(''),
  position: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.05).max(1),
    h: z.number().min(0.05).max(1),
  }),
});
export type MultimediaCollageBuilderItem = z.infer<
  typeof MultimediaCollageBuilderItemSchema
>;

export const MultimediaCollageDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  template: z.string().trim().min(1).max(64),
  mediaItems: z
    .array(MultimediaCollageBuilderItemSchema)
    .min(1, 'Add at least one media item to your collage.')
    .max(20, 'Max 20 media items per collage.'),
  musicUrl: z
    .string()
    .trim()
    .url()
    .or(z.literal(''))
    .nullable()
    .optional()
    .transform((s) => {
      if (s === null || s === undefined) return null;
      const trimmed = (s as string).trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
});
export type MultimediaCollageDraftInput = z.infer<
  typeof MultimediaCollageDraftInputSchema
>;

// ─── recipient-side shape (validated at the type-narrow boundary) ─────────
// The /g/[token]/open dispatch calls this with the raw payload right
// before rendering <MultimediaCollageView />. Throws on mismatch — the
// dispatch page catches via .safeParse() and renders the placeholder.
export const MultimediaCollageRecipientPayloadSchema = MultimediaCollagePayloadSchema;
export type MultimediaCollageRecipientPayload = MultimediaCollagePayload;
