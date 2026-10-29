import 'server-only';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createPublicClient } from '@/lib/supabase/public';
import {
  PRICE_TIER_LOWER_CENTS,
  PRICE_TIER_UPPER_CENTS,
  SETTLEMENT_CURRENCY,
  SETTLEMENT_CURRENCY_DB,
} from '@/lib/money';
import type { SupabaseClient } from '@supabase/supabase-js';

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
 *
 * Which client reads what (OOP-6710): the two PUBLIC reads —
 * `getCatalogFeed` and `searchCatalog` — use the cookie-free
 * `createPublicClient`. They only ever return listed gifts, and the RLS
 * policy lets an anonymous visitor read exactly those rows, so a session
 * would not change the answer — but reading the session cookie would opt
 * the route out of prerendering. The listing detail / comment reads stay on
 * the cookie client: those pages are per-user and dynamic anyway.
 *
 * Currency (OOP-6714): the catalogue settles in ONE currency (HKD). Every
 * row's `price_cents` is HKD cents and every response reports the
 * settlement currency — there is no per-listing currency and no runtime FX
 * conversion. See `src/lib/money.ts`.
 */

// ─── Public types ──────────────────────────────────────────────────────────

export type GiftCategory =
  | 'memory_cards'
  | 'dragdrop_puzzle'
  | 'quiz'
  | 'multimedia_collage'
  | 'animated_letter'
  | 'code';

export type PriceTier = 'free' | 'under_50' | 'under_200' | 'over_200';

export type FeedSort = 'published_desc' | 'most_liked' | 'price_asc';

export type CatalogGift = {
  id: string;
  type: GiftCategory;
  title: string;
  description: string | null;
  category: GiftCategory | null;
  price_cents: number | null;
  /** Always the settlement currency (OOP-6714). */
  currency: string;
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
  /** Always the settlement currency (OOP-6714). */
  currency: string;
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
  'code',
]);

const priceTierEnum = z.enum(['free', 'under_50', 'under_200', 'over_200']);

const feedSortEnum = z.enum(['published_desc', 'most_liked', 'price_asc']);

/**
 * Feed query params. `category` and `creator` are optional filters;
 * `priceTier` collapses the four price buckets into one filter;
 * `sort` picks the ordering; `cursor` is opaque (an encoded
 * `published_at|id` pair).
 *
 * We parse with `.transform` so `?category=memory_cards&priceTier=under_50`
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
 * The `price_cents` band a price tier selects, as separate bounds.
 *
 * `isNull` covers the `free` tier: a gift without a price is treated as
 * free (per M-A constants, `NULL price_cents` means free, not 0).
 */
type PriceTierRange = {
  isNull?: boolean;
  gte?: number;
  lt?: number;
};

/**
 * Map a `priceTier` filter to the band of `price_cents` it selects.
 *
 * The bounds are separate fields, NOT one comma-joined PostgREST string.
 * `or=(price_cents.gte.1,price_cents.lt.500)` means
 * `(price >= 1) OR (price < 500)` — true for every paid row, so all
 * three paid tiers returned the whole catalogue (OOP-6713). A band
 * needs both bounds AND'd, which is what separate filters do; the
 * caller applies each bound as its own filter.
 *
 * The four bands partition the catalogue: `gifts_price_cents_chk`
 * constrains `price_cents` to NULL or a positive integer, so a listed
 * gift is either free (NULL) or lands in exactly one paid band.
 *
 * The edges are HKD cents (OOP-6714): HK$50 and HK$200. They used to be
 * 500 / 2000 cents read as US dollars, which meant a HK$48 item and a
 * €25 item were filed under the same label as a US$120 item.
 */
function priceTierRange(tier: PriceTier): PriceTierRange {
  switch (tier) {
    case 'free':
      return { isNull: true };
    case 'under_50':
      return { gte: 1, lt: PRICE_TIER_LOWER_CENTS };
    case 'under_200':
      return { gte: PRICE_TIER_LOWER_CENTS, lt: PRICE_TIER_UPPER_CENTS };
    case 'over_200':
      return { gte: PRICE_TIER_UPPER_CENTS };
  }
}

const giftSelect =
  'id, type, title, description, category, price_cents, currency, published_at, cover_media_id, payload, owner:profiles_public!owner_id (id, handle, display_name)';

/**
 * Run the feed query. Pagination is via range: we fetch `PAGE_SIZE + 1`
 * rows; if we got more than `PAGE_SIZE`, the extra row becomes the
 * next-cursor anchor.
 *
 * Filters translate to plain PostgREST filters, which are AND'd together.
 * `creator=<handle>` is resolved server-side: we look up the profile id via
 * profiles_public first, then add `owner_id=eq.<uuid>` to the filter chain.
 */
export async function getCatalogFeed(rawParams: unknown): Promise<CatalogFeedResult> {
  const parsed = FeedQuerySchema.safeParse(rawParams);
  if (!parsed.success) return { gifts: [], nextCursor: null };
  const params = parsed.data;

  // Cookie-free: this is public catalog data (see the module note above).
  const supabase = createPublicClient();

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
  if (params.priceTier) {
    // Separate filters — PostgREST ANDs them together. See priceTierRange.
    const band = priceTierRange(params.priceTier);
    if (band.isNull) query = query.is('price_cents', null);
    if (band.gte !== undefined) query = query.gte('price_cents', band.gte);
    if (band.lt !== undefined) query = query.lt('price_cents', band.lt);
  }
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
  assertSettlementCurrency(rows);

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
 * The catalogue settles in one currency (OOP-6714). Rows are stored with
 * `gifts.currency = 'HKD'` and every response reports the settlement
 * currency, so a client never has to branch on it.
 *
 * If a row still carries a different currency, the data migration
 * (`0012_settlement_currency_hkd.sql`) has not been applied and its
 * `price_cents` are in the wrong unit. Say so loudly rather than
 * quietly showing a converted-looking price that is not one.
 */
function assertSettlementCurrency(rows: { currency?: string | null }[]): void {
  const offenders = rows.filter(
    (r) => (r.currency ?? '').trim().toUpperCase() !== SETTLEMENT_CURRENCY_DB,
  );
  if (offenders.length > 0) {
    console.error(
      `[catalog] ${offenders.length} row(s) are not in the settlement currency (${SETTLEMENT_CURRENCY_DB}) — apply migration 0012_settlement_currency_hkd.sql`,
    );
  }
}

/**
 * Map a raw Supabase row from `gifts` into a `CatalogGift`. Calls the
 * `gift_like_count` RPC for the like count; swallows RPC errors so a
 * missing function (e.g. partial migration) doesn't kill the page.
 *
 * Typed against the bare `SupabaseClient` so it accepts either client — the
 * cookie-free public one the feed uses, or the cookie one the listing
 * reads use.
 */
async function hydrateFeedRow(
  supabase: SupabaseClient,
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
    currency: SETTLEMENT_CURRENCY,
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

  // Cookie-free: same reasoning as the feed.
  const supabase = createPublicClient();

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
  assertSettlementCurrency(data ?? []);
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
  assertSettlementCurrency([data]);

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
    currency: SETTLEMENT_CURRENCY,
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

// ─── Threaded gift replies (M-G, OOP-4890) ────────────────────────────────
//
// Distinct from comments (M-D): replies nest via parent_reply_id and
// can be pruned by the listing creator, not just the author. The
// shape returned here is *flat* (server returns rows in
// created_at-asc order); the client component groups by parent_reply_id
// in memory. Keeping it flat keeps the SQL + cursor simple and matches
// the partial index `gift_replies_gift_live_idx`.

export type CatalogListingReply = {
  id: string;
  body: string;
  created_at: string;
  parent_reply_id: string | null;
  user: {
    id: string;
    handle: string;
    display_name: string | null;
  };
};

export type ListingRepliesResult = {
  replies: CatalogListingReply[];
  nextCursor: string | null;
  totalCount: number;
};

const REPLIES_PAGE_SIZE = 20;

function encodeReplyCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}

function decodeReplyCursor(
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
 * Paginated threaded replies for `/l/[giftId]`. Cursor is
 * `(created_at, id)`; oldest-first ordering matches the SSR'd preview
 * so the next page appends naturally without re-shuffling.
 *
 * Returns `{ replies, nextCursor, totalCount }`. `totalCount` is the
 * total live rows for the heading; the SSR page also queries this
 * directly so it doesn't need to count again.
 */
export async function getListingReplies(
  giftId: string,
  cursor: string | null,
): Promise<ListingRepliesResult> {
  if (!giftId || !/^[0-9a-f-]{36}$/i.test(giftId)) {
    return { replies: [], nextCursor: null, totalCount: 0 };
  }

  const supabase = await createClient();

  let query = supabase
    .from('gift_replies')
    .select(
      'id, body, created_at, parent_reply_id, user:profiles_public!user_id (id, handle, display_name)',
    )
    .eq('gift_id', giftId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(REPLIES_PAGE_SIZE + 1);

  if (cursor) {
    const c = decodeReplyCursor(cursor);
    if (c) {
      query = query.or(
        `created_at.gt.${c.createdAt},and(created_at.eq.${c.createdAt},id.gt.${c.id})`,
      );
    }
  }

  const [{ data, error }, { count: totalCount }] = await Promise.all([
    query,
    supabase
      .from('gift_replies')
      .select('id', { count: 'exact', head: true })
      .eq('gift_id', giftId),
  ]);

  if (error) {
    console.error('[catalog/getListingReplies]', error.message);
    return { replies: [], nextCursor: null, totalCount: 0 };
  }

  let rawRows = (data ?? []) as Array<{
    id: string;
    body: string;
    created_at: string;
    parent_reply_id: string | null;
    user: { id: string; handle: string; display_name: string | null } | { id: string; handle: string; display_name: string | null }[];
  }>;

  let nextCursor: string | null = null;
  if (rawRows.length > REPLIES_PAGE_SIZE) {
    const overflow = rawRows[REPLIES_PAGE_SIZE];
    rawRows = rawRows.slice(0, REPLIES_PAGE_SIZE);
    if (overflow) nextCursor = encodeReplyCursor(overflow.created_at, overflow.id);
  }

  const replies: CatalogListingReply[] = rawRows.map((r) => {
    const user = Array.isArray(r.user) ? r.user[0] : r.user;
    return {
      id: r.id,
      body: r.body,
      created_at: r.created_at,
      parent_reply_id: r.parent_reply_id,
      user: {
        id: user?.id ?? '',
        handle: user?.handle ?? '',
        display_name: user?.display_name ?? null,
      },
    };
  });

  return {
    replies,
    nextCursor,
    totalCount: typeof totalCount === 'number' ? totalCount : 0,
  };
}
