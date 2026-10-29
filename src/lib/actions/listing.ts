'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isUuidLike } from '@/lib/uuid';

/**
 * Unpublish / re-publish a listing (OOP-6719).
 *
 * A creator who cannot take down a listing that embarrasses them will stop
 * creating. Until now there was no way to do it — `unpublishGiftAction` was
 * claimed by `docs/USER-FLOWS.md` but had never existed in the code.
 *
 * ## The marketplace-v2 convention
 *
 * Migration 0002 added `gifts.deleted_at` with the note that "application
 * code is expected to set deleted_at when unpublishing". The public
 * catalogue policy (`gifts_select_public_listed`) reads
 *
 *     is_listed = true and published_at is not null and deleted_at is null
 *
 * so a soft-deleted row is gone from /browse, from the JSON feed and from
 * the sitemap (which reads the same feed) the moment `deleted_at` is set.
 * It is NOT a hard delete: the row, its share tokens and its sales history
 * all stay, so the creator can put the listing back and their earnings
 * survive.
 *
 * Unpublishing therefore flips BOTH `is_listed` and `deleted_at`. They
 * describe the same fact from two angles — "this is not on the market" —
 * and leaving them apart is how a listing ends up half-hidden. The
 * catalogue policy ignores `is_listed` for a soft-deleted row anyway, but
 * a query that filters only on `is_listed` (the creator's own gift list,
 * for one) would otherwise still show the listing.
 *
 * `status` is deliberately NOT touched. `is_listed` is the documented
 * source of truth for visibility, and `gifts.status` is still
 * CHECK-constrained to ('draft','sent','archived') because migration 0013
 * has not been applied — writing 'published' would be rejected outright.
 *
 * ## Auth
 *
 * The caller must be signed in and own the gift. `gifts_update_own` is
 * `auth.uid() = owner_id`, so the database refuses the write regardless;
 * the explicit owner read below exists to give a clean error message and
 * to resolve the owner's handle for revalidation.
 */

const inputSchema = z.object({
  giftId: z.string().refine(isUuidLike, 'giftId must be a UUID.'),
});

export type ListingActionResult =
  | { ok: true; giftId: string }
  | { ok: false; error: string };

type OwnedGift = {
  id: string;
  is_listed: boolean;
  deleted_at: string | null;
  published_at: string | null;
  handle: string | null;
};

type OwnedGiftLookup =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      gift: OwnedGift;
      userId: string;
    }
  | { ok: false; error: string };

/**
 * Load the gift and prove the caller owns it.
 *
 * Returns the client alongside the row so the caller can write with the
 * same session — the RLS context is the caller's, not the server's.
 */
async function loadOwnedGift(giftId: string): Promise<OwnedGiftLookup> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'unauthenticated' };
  }

  const { data, error } = await supabase
    .from('gifts')
    .select(
      'id, is_listed, deleted_at, published_at, owner:profiles_public!owner_id(handle)',
    )
    .eq('id', giftId)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[listing] gift read failed', error.message);
    return { ok: false, error: 'Could not load this gift right now.' };
  }
  if (!data) {
    return { ok: false, error: 'Gift not found or you do not own it.' };
  }

  const owner = Array.isArray(data.owner) ? data.owner[0] : data.owner;

  return {
    ok: true,
    supabase,
    userId: user.id,
    gift: {
      id: data.id,
      is_listed: data.is_listed,
      deleted_at: data.deleted_at,
      published_at: data.published_at,
      handle: owner?.handle ?? null,
    },
  };
}

/**
 * Drop the paths that show this listing so nothing serves a stale copy.
 *
 * The surfaces are already uncached — /browse's grid is fetched in the
 * browser against a `no-store` feed, the sitemap is `force-dynamic`, and
 * the profile and listing pages read the auth cookie and are therefore
 * dynamic — so the row change is visible on the next request either way.
 * These calls make that explicit and cover the edge case where a route
 * starts being cached later.
 */
function revalidateListing(giftId: string, handle: string | null) {
  revalidatePath(`/l/${giftId}`);
  revalidatePath('/browse');
  revalidatePath('/sitemap.xml');
  if (handle) revalidatePath(`/u/${handle}`);
}

/**
 * Take a listing off the marketplace.
 *
 * The listing disappears from /browse and from the sitemap immediately.
 * It stays in the creator's own "My Gifts" list, marked unpublished, so
 * it can be published again.
 */
export async function unpublishGiftAction(rawInput: unknown): Promise<ListingActionResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { giftId } = parsed.data;

  const lookup = await loadOwnedGift(giftId);
  if (!lookup.ok) return { ok: false, error: lookup.error };

  const { supabase, gift, userId } = lookup;

  if (gift.deleted_at) {
    return { ok: false, error: 'This listing is already unpublished.' };
  }
  if (!gift.is_listed) {
    return { ok: false, error: 'This gift is not listed on the marketplace.' };
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('gifts')
    .update({ deleted_at: now, is_listed: false })
    .eq('id', giftId)
    .eq('owner_id', userId);

  if (updateErr) {
    console.error('[listing/unpublish] update failed', updateErr.message);
    return { ok: false, error: 'Could not unpublish this gift right now.' };
  }

  revalidateListing(giftId, gift.handle);
  return { ok: true, giftId };
}

/**
 * Put an unpublished listing back on the marketplace.
 *
 * `published_at` is refreshed so the listing returns to the top of the
 * catalogue rather than resurfacing where it was months ago — putting a
 * listing back on the market is a new listing event.
 */
export async function republishGiftAction(rawInput: unknown): Promise<ListingActionResult> {
  const parsed = inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { giftId } = parsed.data;

  const lookup = await loadOwnedGift(giftId);
  if (!lookup.ok) return { ok: false, error: lookup.error };

  const { supabase, gift, userId } = lookup;

  if (!gift.deleted_at) {
    return { ok: false, error: 'This listing is already published.' };
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('gifts')
    .update({ deleted_at: null, is_listed: true, published_at: now })
    .eq('id', giftId)
    .eq('owner_id', userId);

  if (updateErr) {
    console.error('[listing/republish] update failed', updateErr.message);
    return { ok: false, error: 'Could not publish this gift right now.' };
  }

  revalidateListing(giftId, gift.handle);
  return { ok: true, giftId };
}
