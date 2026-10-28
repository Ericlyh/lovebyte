import { z } from 'zod';

/**
 * code — feature module schemas (architecture §6).
 *
 * Re-exports the canonical payload schema from src/lib/gifts/schemas.ts
 * plus a builder-input schema that the /create/code form posts.
 *
 * Per architecture §6, every gift type lives under src/features/<type>/
 * and ships its own:
 *   - builder/         sender-facing UI (route + form components)
 *   - recipient/       type-specific render under /g/[token]
 *   - components/      CodeEditor, ScanPanel, AiSuggestionList
 *   - schemas.ts       Zod schema, imported at the type-narrow boundary
 *                      and at the builder POST path
 *
 * OOP-5688 wires all four. Unlike the other gift types, a `code` gift has
 * no media: the whole gift is three text fields, so there is no
 * /api/upload route involved.
 */

import {
  CodeGiftPayloadSchema,
  CODE_GIFT_MAX_CSS,
  CODE_GIFT_MAX_HTML,
  CODE_GIFT_MAX_JS,
  type CodeGiftPayload,
} from '@/lib/gifts/schemas';

export {
  CodeGiftPayloadSchema,
  CODE_GIFT_MAX_CSS,
  CODE_GIFT_MAX_HTML,
  CODE_GIFT_MAX_JS,
  type CodeGiftPayload,
};

// ─── builder input ────────────────────────────────────────────────────────
// Mirrors the action's input shape, so the form, the server action and the
// recipient boundary all agree on what "valid code gift" means.
export const CodeDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  html: z.string().max(CODE_GIFT_MAX_HTML),
  css: z.string().max(CODE_GIFT_MAX_CSS),
  js: z.string().max(CODE_GIFT_MAX_JS),
  // true → the `js` field holds JSX; it is transpiled at save time and
  // the gift runs on React 18.
  react: z.boolean().default(false),
});
export type CodeDraftInput = z.infer<typeof CodeDraftInputSchema>;

// ─── AI review input ──────────────────────────────────────────────────────
// The draft plus whatever the sender answered when the AI asked for
// missing information ("which photo should be the background?"). The
// answers go back to the model on the second pass so it can turn them
// into concrete edits instead of repeating the question.
export const CodeReviewInputSchema = CodeDraftInputSchema.extend({
  answers: z.string().max(2000).optional(),
});
export type CodeReviewInput = z.infer<typeof CodeReviewInputSchema>;

// ─── recipient-side shape (validated at the type-narrow boundary) ─────────
// The /g/[token]/open dispatch calls this with the raw payload right
// before rendering <CodeGiftView />. Throws on mismatch — the dispatch
// page catches via .safeParse() and renders a "schema mismatch"
// placeholder.
export const CodeRecipientPayloadSchema = CodeGiftPayloadSchema;
export type CodeRecipientPayload = CodeGiftPayload;
