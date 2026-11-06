import { z } from 'zod';

/**
 * The gift-kind catalogue — what KIND of gift a listing is (OOP-7451).
 *
 * ## Why this is not another `gift_type`
 *
 * `gift_type` is a Postgres ENUM (`supabase/migrations/0001_initial_schema.sql`),
 * so a new entry in it needs `ALTER TYPE … ADD VALUE` — DDL. There is no
 * DDL path from the agent host to this project: the Management API PAT is
 * dead, there is no database password, the project exposes no `exec_sql`
 * RPC and pg_graphql is off. A new format is therefore a human paste away
 * (see `supabase/PENDING_PASTE.sql`), not something a build can ship.
 *
 * The KIND is the dimension that does NOT need a schema change: it lives
 * in the gift payload, which is JSONB, and it is what makes two gifts of
 * the same format genuinely different things to buy:
 *
 *   a quiz for a birthday      ≠  a quiz for a graduation
 *   a letter of apology        ≠  a letter of encouragement
 *
 * So the catalogue can offer many kinds per format today, and a new
 * FORMAT can be added later on its own migration without touching this.
 *
 * ## Where a kind is written
 *
 * The publish card asks for it (that is where the listing is described)
 * and `publishToMarketplaceAction` merges it into the gift's payload:
 * `{ ...payload, kind }`. It is optional in every payload schema, so a
 * gift written before this shipped still validates — it just has no
 * kind, and the catalogue shows no chip for it.
 *
 * The labels are English strings, like `GIFT_TYPES` in
 * `src/lib/gifts/types.ts` — that catalogue is not translated either, and
 * a second untranslated list is less surprising than a half-translated
 * one. The browse filter pills ARE translated, under `Catalog.kind.*`.
 */
export const GiftKindSchema = z.enum([
  'just_because',
  'birthday',
  'anniversary',
  'thank_you',
  'apology',
  'encouragement',
  'graduation',
  'friendship',
  'new_baby',
  'long_distance',
]);
export type GiftKind = z.infer<typeof GiftKindSchema>;

/** Every kind id, in catalogue order. */
export const GIFT_KIND_IDS = GiftKindSchema.options;

/**
 * The display metadata for each kind.
 *
 * Typed as a total `Record<GiftKind, …>` on purpose: adding a kind to
 * `GiftKindSchema` without giving it a label here is a TYPE ERROR, not
 * a chip that renders as `undefined`.
 */
export const GIFT_KIND_META: Record<GiftKind, { label: string; emoji: string }> = {
  just_because: { label: 'Just because', emoji: '💛' },
  birthday: { label: 'Birthday', emoji: '🎂' },
  anniversary: { label: 'Anniversary', emoji: '💍' },
  thank_you: { label: 'Thank you', emoji: '🙏' },
  apology: { label: 'Sorry', emoji: '🕊️' },
  encouragement: { label: 'Encouragement', emoji: '🔥' },
  graduation: { label: 'Graduation', emoji: '🎓' },
  friendship: { label: 'Friendship', emoji: '🫶' },
  new_baby: { label: 'New baby', emoji: '👶' },
  long_distance: { label: 'Long distance', emoji: '🌏' },
};

/** The picker order, and the kind a listing gets when the creator does not pick one. */
export const GIFT_KINDS: { value: GiftKind; label: string; emoji: string }[] =
  GIFT_KIND_IDS.map((id) => ({ value: id, ...GIFT_KIND_META[id] }));

export const DEFAULT_GIFT_KIND: GiftKind = 'just_because';

/**
 * The label for a kind id, or null when the id is not a kind we know.
 *
 * The id comes from a JSONB payload, so it is untrusted input: a row
 * written before this shipped, or by a hand-edited payload, can carry
 * anything at all. Unknown ids read as "no kind" rather than as a chip
 * that says `undefined`.
 */
export function giftKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return GIFT_KIND_META[kind as GiftKind]?.label ?? null;
}

/**
 * Read the kind out of a gift payload.
 *
 * The payload is JSONB and untyped at this boundary, so the value is
 * checked against the schema rather than cast. A payload with no `kind`
 * (every gift written before OOP-7451) reads as null.
 */
export function giftKindFromPayload(payload: unknown): GiftKind | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = (payload as Record<string, unknown>).kind;
  const parsed = GiftKindSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
