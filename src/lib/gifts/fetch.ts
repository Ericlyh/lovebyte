import { createClient } from '@/lib/supabase/server';
import { getMockEnvelope } from './mock';
import {
  AnimatedLetterPayloadSchema,
  type RecipientEnvelope,
} from './schemas';

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
      'token, created_at, profiles:created_by (display_name), gifts:gift_id (type, payload)',
    )
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as {
    token: string;
    created_at: string;
    profiles: { display_name: string } | null;
    gifts: { type: string; payload: unknown } | null;
  };
  if (!row.gifts) return null;

  // Validate the payload against the type-specific schema. Other
  // gift types (memory_cards, etc.) are validated by their own
  // feature-module schemas once they ship (Phases 4–8).
  if (row.gifts.type === 'animated_letter') {
    AnimatedLetterPayloadSchema.parse(row.gifts.payload);
  }

  return {
    shareToken: row.token,
    giftType: row.gifts.type as RecipientEnvelope['giftType'],
    senderName: row.profiles?.display_name ?? 'Someone',
    sentAtIso: row.created_at,
    payload: row.gifts.payload,
  };
}
