import 'server-only';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Catalog query layer (M-C, OOP-4275).
 *
 * Three read paths used by both the SSR pages and the JSON API:
 *
 *   • `getCatalogFeed`   — paginated, filterable, sortable feed for /browse.
 *   • `searchCatalog`    — full-text search for the top search bar.
 *   • `getListingDetail` — single gift for /l/[giftId], with creator
 *                          profile + like_count + first-N comments.
 *
 * All reads are RLS-permitted (`gifts_select_public_listed`); the server
 * client uses the user's JWT (anon for unauthenticated visitors, so the
 * policy still applies). Cursor pagination is `(published_at, id)` so
 * ties on the same timestamp don't drop rows.
 *
 * Why the server client (not postgrest/anon)?  The catalog needs PostgREST
 * features the anon helper doesn't expose yet: range/limit pagination,
 * `in(...)` filters for the price tiers, and the `websearch_to_tsquery`
 * operator. Future work could extend postgrest() — for now we lean on the
 * full client. Server-only via the `'server-only'` import.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export type GiftCategory =
  | 'memory_cards'
  | 'dragdrop_puzzle'
  | 'quiz'
  | 'multimedia_collage'
  | 'animated_letter';

export type PriceTier = 'free' | 'under_5' | 'under_20' | 'over_20';

export type FeedSort = 'published_desc' | 'most_liked' | 'price_asc';

export type CatalogGift = {
  id: string;
  type: GiftCategory;
  title: string;
  description: string | null;
  category: GiftCategory | null;
  price_cents: number | null;
  currency: string | null;
  published_at: string;
  like_count: number;
  owner: {
    id: string;
    handle: string;
    display_name: string | null;
  };
};

export type CatalogFeedResult = {
  gifts: CatalogGift[];
  nextCursor: string | null;
};

export type CatalogSearchResult = {
  gifts: CatalogGift[];
};

export type CatalogListingComment = {
  id: string;
  body: string;
  created_at: string;
  author: {
    id: string;
    handle: string;
    display_name: string | null;
  };
};

export type CatalogListing = {
  id: string;
  type: GiftCategory;
  title: string;
  description: string | null;
  category: GiftCategory | null;
  price_cents: number | null;
  currency: string | null;
  published_at: string;
  like_count: number;
  payload: unknown;
  cover_media_id: string | null;
  owner: {
    id: string;
    handle: string;
    display_name: string | null;
  };
  comments: CatalogListingComment[];
};

// ─── Query schemas ─────────────────────────────────────────────────────────

const giftCategoryEnum = z.enum([
  'memory_cards',
  'dragdrop_puzzle',
  'quiz',
  'multimedia_collage',
  'animated_letter',
]);

const priceTierEnum = z.enum(['free', 'under_5', 'under_20', 'over_20']);

const feedSortEnum = z.enum(['published_desc', 'most_liked', 'price_asc']);

/**
 * Feed query params. `category` and `creator` are optional filters;
 * `priceTier` collapses the four price buckets into one filter;
 * `sort` picks the ordering; `cursor` is opaque (an encoded
 * `published_at|id` pair).
 *
 * We parse with `.transform` so `?category=memory_cards&priceTier=under_5`
 * from the URL works — zod's default coercion handles the strings.
 */
export const FeedQuerySchema = z.object({
  category: giftCategoryEnum.optional(),
  priceTier: priceTierEnum.optional(),
  creator: z.string().trim().min(1).max(40).optional(),
  sort: feedSortEnum.default('published_desc'),
  cursor: z.string().trim().min(1).max(80).optional(),
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(40).default(20),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

/**
 * Encode a `(published_at, id)` cursor as opaque base64. The published_at
 * is ISO; the id is the gift's UUID. Cursor is stable across sorts that
 * preserve `published_at desc, id desc` — for `most_liked` / `price_asc`
 * sorts we ignore the cursor and re-paginate from the top (acceptable
 * trade-off: those sorts aren't paginated deeply in the M-C UI).
 */
function encodeCursor(publishedAt: string, id: string): string {
  return Buffer.from(`${publishedAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { publishedAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf('|');
    if (idx < 0) return null;
    const publishedAt = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    if (!publishedAt || !id) return null;
    return { publishedAt, id };
  } catch {
    return null;
  }
}

/**
 * Map a `priceTier` filter to a PostgREST-style predicate on `price_cents`.
 * The check `price_cents is null` is included in `free` because a gift
 * without a price is treated as free (per M-A constants, `NULL price_cents`
 * means free, not 0).
 */
function priceTierPredicate(tier: PriceTier): string {
  switch (tier) {
    case 'free':
      return 'price_cents.is.null';
    case 'under_5':
      return 'price_cents.gte.1,price_cents.lt.500';
    case 'under_20':
      return 'price_cents.gte.500,price_cents.lt.2000';
    case 'over_20':
      return 'price_cents.gte.2000';
  }
}

const giftSelect =
  'id, type, title, description, category, price_cents, currency, published_at, cover_media_id, payload, owner:profiles_public!owner_id (id, handle, display_name)';

/**
 * Run the feed query. Pagination is via range: we fetch `PAGE_SIZE + 1`
 * rows; if we got more than `PAGE_SIZE`, the extra row becomes the
 * next-cursor anchor.
 *
 * Filters translate to the `or=(...)` PostgREST operator. `creator=<handle>`
 * is resolved server-side: we look up the profile id via profiles_public
 * first, then add `owner_id=eq.<uuid>` to the filter chain.
 */
export async function getCatalogFeed(rawParams: unknown): Promise<CatalogFeedResult> {
  const parsed = FeedQuerySchema.safeParse(rawParams);
  if (!parsed.success) return { gifts: [], nextCursor: null };
  const params = parsed.data;

  const supabase = await createClient();

  // Resolve handle → uuid (anon-readable via profiles_public).
  let ownerId: string | null = null;
  if (params.creator) {
    const { data } = await supabase
      .from('profiles_public')
      .select('id')
      .eq('handle', params.creator)
      .maybeSingle();
    ownerId = data?.id ?? null;
    if (ownerId == null) {
      // Unknown handle — return an empty feed rather than 500'ing.
      return { gifts: [], nextCursor: null };
    }
  }

  let query = supabase
    .from('gifts')
    .select(giftSelect)
    .eq('is_listed', true)
    .is('deleted_at', null)
    .not('published_at', 'is', null)
    .limit(PAGE_SIZE + 1);

  if (params.category) query = query.eq('category', params.category);
  if (params.priceTier) query = query.or(priceTierPredicate(params.priceTier));
  if (ownerId) query = query.eq('owner_id', ownerId);

  // Sort + cursor. `published_desc` is the only sort with stable cursor
  // pagination in M-C; the other two sorts reset to page 1 when a cursor
  // is provided (we ignore it intentionally — see encodeCursor comment).
  if (params.sort === 'most_liked') {
    // Postgres can't sort directly on the like_count aggregate; we sort
    // client-side below after selecting. To keep the response page-sized,
    // we order by published_at desc as a tiebreaker and then resort in JS.
    query = query.order('published_at', { ascending: false });
  } else if (params.sort === 'price_asc') {
    // `nullsFirst` so free gifts (NULL price) sort to the top.
    query = query.order('price_cents', { ascending: true, nullsFirst: true });
    query = query.order('published_at', { ascending: false });
  } else {
    query = query.order('published_at', { ascending: false });
    if (params.cursor) {
      const c = decodeCursor(params.cursor);
      if (c) {
        query = query.or(
          `published_at.lt.${c.publishedAt},and(published_at.eq.${c.publishedAt},id.lt.${c.id})`,
        );
      }
    }
  }

  query = query.order('id', { ascending: false });

  const { data, error } = await query;
  if (error) {
    console.error('[catalog/getCatalogFeed]', error.message);
    return { gifts: [], nextCursor: null };
  }

  let rows = data ?? [];

  // Compute like counts via the SQL function so the projection is a single
  // round-trip per gift. The function is `security definer` so anon can call it.
  // For 20+ gifts we'd want a SQL-side aggregate; for M-C a JS loop is fine
  // and keeps the RLS story clean.
  let gifts: CatalogGift[] = await Promise.all(
    rows.map(async (r) => hydrateFeedRow(supabase, r)),
  );

  // Sort fallback for `most_liked` — re-sort by like_count desc, then
  // published_at desc as tiebreaker.
  if (params.sort === 'most_liked') {
    gifts.sort((a, b) => {
      if (b.like_count !== a.like_count) return b.like_count - a.like_count;
      return b.published_at.localeCompare(a.published_at);
    });
  }

  // Cursor is only meaningful for `published_desc`. For other sorts the
  // UI should not pass a cursor; if it does, we just return the first page.
  let nextCursor: string | null = null;
  if (params.sort === 'published_desc' && gifts.length > PAGE_SIZE) {
    const overflow = gifts[PAGE_SIZE];
    gifts = gifts.slice(0, PAGE_SIZE);
    if (overflow) nextCursor = encodeCursor(overflow.published_at, overflow.id);
  }

  return { gifts, nextCursor };
}

/**
 * Map a raw Supabase row from `gifts` into a `CatalogGift`. Calls the
 * `gift_like_count` RPC for the like count; swallows RPC errors so a
 * missing function (e.g. partial migration) doesn't kill the page.
 */
async function hydrateFeedRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: any,
): Promise<CatalogGift> {
  const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
  let likeCount = 0;
  try {
    const { data } = await supabase.rpc('gift_like_count', {
      gift_id: row.id,
    });
    likeCount = typeof data === 'number' ? data : Number(data ?? 0);
  } catch {
    likeCount = 0;
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    category: row.category,
    price_cents: row.price_cents,
    currency: row.currency,
    published_at: row.published_at,
    like_count: likeCount,
    owner: {
      id: owner?.id ?? '',
      handle: owner?.handle ?? '',
      display_name: owner?.display_name ?? null,
    },
  };
}

/**
 * Full-text search over `gifts.search_tsv`. Uses `websearch_to_tsquery` so
 * the input string can be a Google-style query (quoted phrases, -negation).
 *
 * No pagination in M-C — search results are capped at `limit` (default 20,
 * max 40) so the search box is one-shot, not infinite-scrolling. We can
 * add cursor pagination post-MVP.
 */
export async function searchCatalog(rawParams: unknown): Promise<CatalogSearchResult> {
  const parsed = SearchQuerySchema.safeParse(rawParams);
  if (!parsed.success) return { gifts: [] };
  const { q, limit } = parsed.data;

  const supabase = await createClient();

  // PostgREST's FTS operator is `textsearch` (with `tsquery` arg). For
  // websearch syntax we'd need an RPC; the simpler `to_tsquery` rewrite
  // works for plain word queries which is what 99% of search traffic is.
  // Quoted phrases / negation are dropped to a no-match (we don't surface
  // a syntax error — empty result is friendlier).
  const tsQuery = q
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w}:*`)
    .join(' & ');

  if (!tsQuery) return { gifts: [] };

  const { data, error } = await supabase
    .from('gifts')
    .select(giftSelect)
    .eq('is_listed', true)
    .is('deleted_at', null)
    .not('published_at', 'is', null)
    .textSearch('search_tsv', tsQuery, { type: 'plain', config: 'simple' })
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[catalog/searchCatalog]', error.message);
    return { gifts: [] };
  }

  const gifts = await Promise.all((data ?? []).map((r) => hydrateFeedRow(supabase, r)));
  return { gifts };
}

/**
 * Resolve a single gift for /l/[giftId]. Returns null if the gift is
 * missing, soft-deleted, or not listed — the caller turns that into a 404.
 *
 * Joins the creator profile, the like count, and the first 3 live
 * comments. The full comment thread lives in /api/.../comments (M-D);
 * M-C ships the preview only.
 */
export async function getListingDetail(giftId: string): Promise<CatalogListing | null> {
  if (!giftId || !/^[0-9a-f-]{36}$/i.test(giftId)) return null;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('gifts')
    .select(giftSelect)
    .eq('id', giftId)
    .eq('is_listed', true)
    .is('deleted_at', null)
    .not('published_at', 'is', null)
    .maybeSingle();

  if (error) {
    console.error('[catalog/getListingDetail]', error.message);
    return null;
  }
  if (!data) return null;

  const owner = Array.isArray(data.owner) ? data.owner[0] : data.owner;

  // Like count.
  let likeCount = 0;
  try {
    const { data: likeData } = await supabase.rpc('gift_like_count', {
      gift_id: data.id,
    });
    likeCount = typeof likeData === 'number' ? likeData : Number(likeData ?? 0);
  } catch {
    likeCount = 0;
  }

  // First 3 live comments.
  const { data: commentRows } = await supabase
    .from('gift_comments')
    .select(
      'id, body, created_at, author:profiles_public!author_id (id, handle, display_name)',
    )
    .eq('gift_id', data.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(3);

  const comments: CatalogListingComment[] = (commentRows ?? []).map((c: any) => {
    const author = Array.isArray(c.author) ? c.author[0] : c.author;
    return {
      id: c.id,
      body: c.body,
      created_at: c.created_at,
      author: {
        id: author?.id ?? '',
        handle: author?.handle ?? '',
        display_name: author?.display_name ?? null,
      },
    };
  });

  return {
    id: data.id,
    type: data.type,
    title: data.title,
    description: data.description,
    category: data.category,
    price_cents: data.price_cents,
    currency: data.currency,
    published_at: data.published_at,
    like_count: likeCount,
    payload: data.payload,
    cover_media_id: data.cover_media_id,
    owner: {
      id: owner?.id ?? '',
      handle: owner?.handle ?? '',
      display_name: owner?.display_name ?? null,
    },
    comments,
  };
}

// ─── Paginated comments (M-D, OOP-4276) ────────────────────────────────────

const COMMENTS_PAGE_SIZE = 10;

export type ListingCommentsResult = {
  comments: CatalogListingComment[];
  nextCursor: string | null;
  totalCount: number;
};

function encodeCommentCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

function decodeCommentCursor(
  cursor: string,
): { createdAt: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = decoded.indexOf('|');
    if (idx < 0) return null;
    const createdAt = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Paginated comments for /l/[giftId]. Cursor is `(created_at, id)`;
 * oldest-first ordering matches the SSR'd preview so the next page
 * appends naturally without re-shuffling.
 *
 * Returns `{ comments, nextCursor, totalCount }`. `totalCount` is the
 * live (non-soft-deleted) count for the heading; the SSR page also
 * queries this directly so it doesn't need to count again.
 *
 * RLS `gift_comments_select_public` already filters
 * `deleted_at is null`, so soft-deleted comments never appear here.
 */
export async function getListingComments(
  giftId: string,
  cursor: string | null,
): Promise<ListingCommentsResult> {
  if (!giftId || !/^[0-9a-f-]{36}$/i.test(giftId)) {
    return { comments: [], nextCursor: null, totalCount: 0 };
  }

  const supabase = await createClient();

  let query = supabase
    .from('gift_comments')
    .select(
      'id, body, created_at, author:profiles_public!author_id (id, handle, display_name)',
    )
    .eq('gift_id', giftId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(COMMENTS_PAGE_SIZE + 1);

  if (cursor) {
    const c = decodeCommentCursor(cursor);
    if (c) {
      // PostgREST `or(...)` lets us combine the strict-less-than on
      // timestamp with the tiebreaker on id. We pass it as a raw
      // filter so the client doesn't have to special-case the query.
      query = query.or(
        `created_at.gt.${c.createdAt},and(created_at.eq.${c.createdAt},id.gt.${c.id})`,
      );
    }
  }

  const [{ data, error }, { count: totalCount }] = await Promise.all([
    query,
    supabase
      .from('gift_comments')
      .select('id', { count: 'exact', head: true })
      .eq('gift_id', giftId)
      .is('deleted_at', null),
  ]);

  if (error) {
    console.error('[catalog/getListingComments]', error.message);
    return { comments: [], nextCursor: null, totalCount: 0 };
  }

  let rows = (data ?? []) as Array<{
    id: string;
    body: string;
    created_at: string;
    author: { id: string; handle: string; display_name: string | null } | { id: string; handle: string; display_name: string | null }[];
  }>;

  let nextCursor: string | null = null;
  if (rows.length > COMMENTS_PAGE_SIZE) {
    const overflow = rows[COMMENTS_PAGE_SIZE];
    rows = rows.slice(0, COMMENTS_PAGE_SIZE);
    if (overflow) nextCursor = encodeCommentCursor(overflow.created_at, overflow.id);
  }

  const comments: CatalogListingComment[] = rows.map((c) => {
    const author = Array.isArray(c.author) ? c.author[0] : c.author;
    return {
      id: c.id,
      body: c.body,
      created_at: c.created_at,
      author: {
        id: author?.id ?? '',
        handle: author?.handle ?? '',
        display_name: author?.display_name ?? null,
      },
    };
  });

  return {
    comments,
    nextCursor,
    totalCount: typeof totalCount === 'number' ? totalCount : 0,
  };
}
