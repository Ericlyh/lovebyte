import { createClient } from '@/lib/supabase/server';
import { getMockEnvelope } from './mock';
import {
  AnimatedLetterPayloadSchema,
  CodeGiftPayloadSchema,
  DragdropPuzzlePayloadSchema,
  MemoryCardsPayloadSchema,
  MultimediaCollagePayloadSchema,
  type RecipientEnvelope,
} from './schemas';

/**
 * The payload schema for each gift type this fetcher validates.
 *
 * `quiz` is deliberately absent: the quiz flow validates its payload at
 * the /g/[token]/open dispatch, which renders its own "not shipped yet"
 * state for a mismatch. The other five are checked here as well, so a
 * broken payload never reaches the envelope.
 */
const PAYLOAD_SCHEMAS: Record<string, { safeParse: (v: unknown) => { success: boolean } }> = {
  animated_letter: AnimatedLetterPayloadSchema,
  memory_cards: MemoryCardsPayloadSchema,
  dragdrop_puzzle: DragdropPuzzlePayloadSchema,
  multimedia_collage: MultimediaCollagePayloadSchema,
  code: CodeGiftPayloadSchema,
};

/**
 * Resolve a share token to a RecipientEnvelope.
 *
 * Dispatch:
 *   • If NEXT_PUBLIC_SUPABASE_URL is set AND a shares row exists for
 *     `token`, return the live envelope (validated by the type-specific
 *     Zod schema).
 *   • Otherwise fall back to the seeded mock so local dev and the
 *     pre-Supabase deploy still render the recipient envelope.
 *
 * This is the single entry point used by both the /g/[token] page and
 * the /api/og/[shareToken] route. Returns null when the token does
 * not resolve in either source — callers decide how to render the
 * 404 (the page renders a "this gift has expired" empty state).
 *
 * NOTE: This module uses the cookie-bound server client, which is
 * appropriate for Server Components and Route Handlers. It does NOT
 * require the user to be authenticated (anon SELECT on `shares` is
 * granted by the RLS policy `shares_select_public_by_token`).
 */
export async function getEnvelopeByToken(
  token: string,
): Promise<RecipientEnvelope | null> {
  const liveEnvelope = await fetchFromSupabase(token);
  if (liveEnvelope) return liveEnvelope;
  return getMockEnvelope(token);
}

async function fetchFromSupabase(
  token: string,
): Promise<RecipientEnvelope | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('shares')
    .select(
      'token, created_at, profiles:created_by (display_name), gifts:gift_id (id, type, payload)',
    )
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    token: string;
    created_at: string;
    profiles: { display_name: string } | null;
    gifts: { id: string; type: string; payload: unknown } | null;
  };
  if (!row.gifts) return null;

  // Validate the payload against the type-specific schema at the
  // type-narrow boundary (architecture §6). Each gift type validates
  // here AND at the /g/[token]/open dispatch — defence in depth.
  //
  // A mismatch resolves to null instead of throwing (OOP-6715). A
  // share can point at any listed gift now that a buyer can mint one
  // for a free listing, and the seeded catalogue has listings whose
  // payload does not match its schema. `parse` turned that mismatch
  // into a 500 on /g/[token]; null renders the recipient page's
  // not-found state, which is what an unresolvable token does anyway.
  const payloadSchema = PAYLOAD_SCHEMAS[row.gifts.type];
  if (payloadSchema && !payloadSchema.safeParse(row.gifts.payload).success) {
    return null;
  }

  return {
    shareToken: row.token,
    giftId: row.gifts.id,
    giftType: row.gifts.type as RecipientEnvelope['giftType'],
    senderName: row.profiles?.display_name ?? 'Someone',
    sentAtIso: row.created_at,
    payload: row.gifts.payload,
  };
}
