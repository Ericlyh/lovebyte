import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Owner-only "my gifts" collection for /u/[handle] (OOP-5685).
 *
 * Returns the creator's full gift library — drafts, unlisted, and listed —
 * so they can re-open, edit, or list them. For non-owners the result is
 * always empty: the server client carries the visitor's JWT and the
 * `gifts_select_own` RLS policy (`auth.uid() = owner_id`) filters
 * everything else out. The caller checks `viewerIsOwner` before rendering
 * the section, so the empty-array case is purely defensive.
 *
 * Hydration mirrors `hydrateFeedRow` (catalog) so a `GiftCard` accepts the
 * returned shape without a separate render path. We deliberately avoid
 * `getCatalogFeed({creator})` — that view is `is_listed = true`-only and
 * would hide drafts + unlisted gifts from the creator.
 *
 * Cap is 20 (matches the existing `getCatalogFeed` PAGE_SIZE) — the page
 * already says "your collection" without pagination; if a creator
 * legitimately needs to see >20 we can add cursor paging post-MVP.
 */
/**
 * Public shape returned by `getOwnedGifts`. Mirrors `CatalogGift` so a
 * single `GiftCard` component can render both /browse and the owner's
 * "my gifts" grid without branching.
 *
 * • `title` is normalised to a non-null string (the gift-type label
 *   for drafts that don't yet have a name) so the card's type contract
 *   holds and the grid never renders a blank tile.
 * • `published_at` falls back to `created_at` for drafts + unlisted.
 *   The visual card doesn't render the timestamp either way.
 */
export type OwnedGift = {
  id: string;
  type: 'memory_cards' | 'dragdrop_puzzle' | 'quiz' | 'multimedia_collage' | 'animated_letter';
  title: string;
  description: string | null;
  category: 'memory_cards' | 'dragdrop_puzzle' | 'quiz' | 'multimedia_collage' | 'animated_letter' | null;
  price_cents: number | null;
  currency: string | null;
  published_at: string;
  like_count: number;
  is_listed: boolean;
  cover_media_id: string | null;
  created_at: string;
  owner: {
    id: string;
    handle: string;
    display_name: string | null;
  };
};

const TYPE_LABEL: Record<OwnedGift['type'], string> = {
  memory_cards: 'Memory cards draft',
  dragdrop_puzzle: 'Puzzle draft',
  quiz: 'Quiz draft',
  multimedia_collage: 'Collage draft',
  animated_letter: 'Letter draft',
};

const OWNED_PAGE_SIZE = 20;

const ownedGiftSelect =
  'id, type, title, description, category, price_cents, currency, published_at, like_count, is_listed, cover_media_id, created_at, owner:profiles_public!owner_id (id, handle, display_name)';

/**
 * Fetch the creator's own gifts by handle. Returns `[]` if the handle
 * doesn't resolve to a profile (the caller already 404s on that path)
 * or if the visitor isn't the owner (RLS denies the SELECT and PostgREST
 * returns zero rows).
 */
export async function getOwnedGifts(handle: string): Promise<OwnedGift[]> {
  if (!handle) return [];
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles_public')
    .select('id, handle, display_name')
    .eq('handle', handle)
    .maybeSingle();
  if (!profile) return [];

  const { data, error } = await supabase
    .from('gifts')
    .select(ownedGiftSelect)
    .eq('owner_id', profile.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(OWNED_PAGE_SIZE);

  if (error) {
    console.error('[getOwnedGifts] supabase error', error.message);
    return [];
  }

  // `like_count` isn't a column on `gifts` — it's a SQL aggregate.
  // Re-use `gift_like_count` RPC like the rest of the catalog. For 20
  // gifts the N+1 is fine; for more we'd compute it server-side.
  const rows = data ?? [];
  return await Promise.all(
    rows.map(async (r): Promise<OwnedGift> => {
      const owner = Array.isArray(r.owner) ? r.owner[0] : r.owner;
      let likeCount = 0;
      try {
        const { data: likeData } = await supabase.rpc('gift_like_count', {
          gift_id: r.id,
        });
        likeCount = typeof likeData === 'number' ? likeData : Number(likeData ?? 0);
      } catch {
        likeCount = 0;
      }
      // Drafts + unlisted gifts have a NULL `published_at`. Normalise to
      // `created_at` so the OwnedGift matches the CatalogGift contract
      // (`published_at: string`) and GiftCard accepts it directly.
      // Same trick for `title`: drafts may have no name; fall back to
      // a typed label so the card always has something to render.
      const giftType = r.type as OwnedGift['type'];
      const fallbackTitle = TYPE_LABEL[giftType] ?? 'Untitled gift';
      return {
        id: r.id,
        type: r.type,
        title: r.title ?? fallbackTitle,
        description: r.description,
        category: r.category,
        price_cents: r.price_cents,
        currency: r.currency,
        published_at: r.published_at ?? r.created_at,
        like_count: likeCount,
        is_listed: r.is_listed,
        cover_media_id: r.cover_media_id,
        created_at: r.created_at,
        owner: {
          id: owner?.id ?? profile.id,
          handle: owner?.handle ?? profile.handle,
          display_name: owner?.display_name ?? profile.display_name ?? null,
        },
      };
    }),
  );
}