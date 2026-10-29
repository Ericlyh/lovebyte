import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalogFeed, getListingDetail } from './catalog';

/**
 * Regression tests for the catalogue price-tier filter (OOP-6713) and
 * the single settlement currency (OOP-6714).
 *
 * OOP-6713 — the bug: `priceTierPredicate` packed a tier's bounds into ONE
 * comma-joined PostgREST string (`price_cents.gte.1,price_cents.lt.500`)
 * and handed it to `.or()`. PostgREST reads `or=(a,b)` as two OR'd
 * conditions, so the filter was really `(price >= 1) OR (price < 500)` —
 * true for every paid row. Every paid tier therefore returned the whole
 * catalogue, and "Under $5" showed a $120 item.
 *
 * OOP-6714 — the tiers are now bands in the settlement currency (HKD):
 * under HK$50, HK$50–HK$200, HK$200 and up. The fixture prices sit
 * exactly on the new band edges so an off-by-one in either bound fails a
 * test, and every row carries the settlement currency because the feed
 * reports one currency for the whole catalogue.
 *
 * These tests run the real `getCatalogFeed` against a fake PostgREST
 * engine with the same semantics as the real one — `.or()` is a
 * disjunction, separate filters are AND'd together, and a comparison
 * against NULL is never true — so they fail against the old code and
 * pass against the fix.
 */

type Row = Record<string, unknown>;
type Condition = (row: Row) => boolean;

// ─── The fixture catalogue ────────────────────────────────────────────────

/**
 * Prices sit exactly on the band edges on purpose (4999/5000/19999/20000)
 * so an off-by-one in either bound fails a test. Every row is in the
 * settlement currency (HKD) — the catalogue no longer holds a second one.
 */
const CATALOGUE: Row[] = [
  { id: 'f1', title: 'Free note', price_cents: null, currency: 'HKD' },
  { id: 'f2', title: 'Free quiz', price_cents: null, currency: 'HKD' },
  { id: 'u50a', title: 'Ninety-nine cents', price_cents: 99, currency: 'HKD' },
  { id: 'u50b', title: 'Forty-nine ninety-nine', price_cents: 4999, currency: 'HKD' },
  { id: 'u200a', title: 'Fifty', price_cents: 5000, currency: 'HKD' },
  { id: 'u200b', title: 'One hundred ninety-nine', price_cents: 19999, currency: 'HKD' },
  { id: 'o200a', title: 'Two hundred', price_cents: 20000, currency: 'HKD' },
  { id: 'o200b', title: 'Nine hundred', price_cents: 90000, currency: 'HKD' },
];

const PROFILES: Row[] = [
  { id: '11111111-1111-1111-1111-111111111111', handle: 'ada' },
];

function toRow(partial: Row): Row {
  return {
    type: 'memory_cards',
    description: null,
    category: 'memory_cards',
    cover_media_id: null,
    cover: null,
    payload: null,
    deleted_at: null,
    is_listed: true,
    published_at: '2026-10-01T00:00:00.000Z',
    owner: { id: 'p1', handle: 'ada', display_name: 'Ada' },
    /**
     * The rows `gift_likes` holds for this gift. The fake PostgREST
     * engine turns this into the `gift_likes(count)` aggregate embed,
     * and the fake `gift_like_count` RPC counts the same array — so the
     * two paths are compared against one source of truth, the way the
     * real database compares them (OOP-6722).
     */
    likes: [] as number[],
    ...partial,
  };
}

const ROWS: Row[] = CATALOGUE.map(toRow);

// ─── The fake PostgREST engine ─────────────────────────────────────────────

function isNull(value: unknown): boolean {
  return value === null || value === undefined;
}

/**
 * SQL comparison. Returns null when either side is NULL — a comparison
 * with NULL is never TRUE in a WHERE clause.
 */
function compare(a: unknown, b: unknown): number | null {
  if (isNull(a) || isNull(b)) return null;
  if (typeof a === 'number' && typeof b === 'number') {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const as = String(a);
  const bs = String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function applyOp(value: unknown, op: string, raw: string): boolean {
  if (op === 'is') {
    if (raw === 'null') return isNull(value);
    if (raw === 'not.null') return !isNull(value);
    return String(value) === raw;
  }
  if (op === 'eq') {
    if (raw === 'null') return isNull(value);
    return compare(value, raw) === 0;
  }
  if (op === 'neq') {
    if (raw === 'null') return !isNull(value);
    return compare(value, raw) !== 0;
  }
  /**
   * The ordering operators compare against a NUMBER only when the
   * literal is one. The cursor filter compares a timestamp column
   * against a timestamp literal (`published_at.lt.2026-08-06T07:41:…`),
   * and `Number('2026-08-06T…')` is NaN — every row would then compare
   * "less than NaN" and the feed would hand back the same page for
   * ever. PostgREST compares a timestamptz against a timestamptz, and
   * ISO-8601 in one format sorts the same lexicographically as it does
   * chronologically, so a text comparison is exact here.
   */
  const numeric = op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte';
  const operand = numeric && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
  const c = compare(value, operand);
  if (c === null) return false;
  if (op === 'lt') return c < 0;
  if (op === 'lte') return c <= 0;
  if (op === 'gt') return c > 0;
  if (op === 'gte') return c >= 0;
  throw new Error(`fake PostgREST: unknown operator "${op}"`);
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

/** Parse `col.op.value` / `and(...)` into a predicate, PostgREST-style. */
function parseFilterExpression(expr: string): Condition {
  const trimmed = expr.trim();
  if (trimmed.startsWith('and(') && trimmed.endsWith(')')) {
    const parts = splitTopLevel(trimmed.slice(4, -1)).map(parseFilterExpression);
    return (row) => parts.every((p) => p(row));
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_]+)\.(.*)$/.exec(trimmed);
  if (!match) throw new Error(`fake PostgREST: cannot parse "${expr}"`);
  const [, column, op, raw] = match;
  return (row) => applyOp(row[column], op, raw);
}

type Order = { column: string; ascending: boolean; nullsFirst: boolean };

class FakeQueryBuilder {
  private readonly filters: Condition[] = [];
  private readonly orders: Order[] = [];
  private limitCount: number | null = null;

  constructor(
    private readonly rows: Row[],
    private readonly orCalls: string[],
  ) {}

  /** The projection is ignored — the fake returns whole fixture rows. */
  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push((r) =>
      value === null ? isNull(r[column]) : r[column] === value,
    );
    return this;
  }

  not(column: string, op: string, value: unknown) {
    this.filters.push((r) => !applyOp(r[column], op, String(value)));
    return this;
  }

  gt(column: string, value: number) {
    this.filters.push((r) => {
      const c = compare(r[column], value);
      return c !== null && c > 0;
    });
    return this;
  }

  gte(column: string, value: number) {
    this.filters.push((r) => {
      const c = compare(r[column], value);
      return c !== null && c >= 0;
    });
    return this;
  }

  lt(column: string, value: number) {
    this.filters.push((r) => {
      const c = compare(r[column], value);
      return c !== null && c < 0;
    });
    return this;
  }

  lte(column: string, value: number) {
    this.filters.push((r) => {
      const c = compare(r[column], value);
      return c !== null && c <= 0;
    });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }

  /** PostgREST `or=(a,b)` — a DISJUNCTION. This is the trap OOP-6713 fell into. */
  or(expression: string) {
    this.orCalls.push(expression);
    const branches = splitTopLevel(expression).map(parseFilterExpression);
    this.filters.push((r) => branches.some((b) => b(r)));
    return this;
  }

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst === true,
    });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.limitCount = to - from + 1;
    return this;
  }

  async maybeSingle() {
    const rows = this.run();
    return { data: rows[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onFulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve({ data: this.run(), error: null }).then(
      onFulfilled,
      onRejected,
    );
  }

  private run(): Row[] {
    let rows = this.rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.column];
          const bv = b[o.column];
          if (av === bv) continue;
          const aNull = isNull(av);
          const bNull = isNull(bv);
          if (aNull || bNull) {
            if (aNull && bNull) continue;
            return aNull ? (o.nullsFirst ? -1 : 1) : o.nullsFirst ? 1 : -1;
          }
          // Neither side is NULL here, so compare() never returns null.
          const c = compare(av, bv) ?? 0;
          if (c !== 0) return o.ascending ? c : -c;
        }
        return 0;
      });
    }
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    // PostgREST's aggregate embed: `gift_likes(count)` arrives as an
    // array holding the single aggregate row — `[{ count: N }]` — and the
    // count is the number of child rows, exactly as the database
    // computes it (OOP-6722).
    return rows.map((r) => ({
      ...r,
      gift_likes: [{ count: (r.likes as number[] | undefined)?.length ?? 0 }],
    }));
  }
}

// ─── The mocked Supabase clients ───────────────────────────────────────────

const state = vi.hoisted(() => ({
  orCalls: [] as string[],
  /** Every RPC the code called — OOP-6722 asserts the feed calls none. */
  rpcCalls: [] as string[],
  /**
   * The catalogue the fake PostgREST serves. `null` means the default
   * fixture; a test that needs a catalogue bigger than one feed page
   * swaps it (OOP-6730).
   */
  rows: null as Row[] | null,
}));

function createFakeClient() {
  return {
    from(table: string) {
      return new FakeQueryBuilder(
        table === 'profiles_public' ? PROFILES : (state.rows ?? ROWS),
        state.orCalls,
      );
    },
    /**
     * The `gift_like_count` SQL function — `security definer`, so it
     * counts every like on the gift. The fake counts the row's `likes`
     * array, which is the same source the aggregate embed is computed
     * from (OOP-6722).
     */
    rpc(fn: string, args?: { gift_id?: string }) {
      state.rpcCalls.push(fn);
      if (fn === 'gift_like_count') {
        const row = ROWS.find((r) => r.id === args?.gift_id);
        const count = (row?.likes as number[] | undefined)?.length ?? 0;
        return Promise.resolve({ data: count, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    /** The media bucket is public, so the public URL is a plain path. */
    storage: {
      from(bucket: string) {
        return {
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://cdn.test/${bucket}/${path}` } };
          },
        };
      },
    },
  };
}

vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: () => createFakeClient(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeClient(),
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

async function idsForTier(tier?: string): Promise<string[]> {
  const result = await getCatalogFeed({ priceTier: tier });
  return result.gifts.map((g) => g.id).sort();
}

describe('catalog price-tier filter (OOP-6713)', () => {
  beforeEach(() => {
    state.orCalls.length = 0;
  });

  it('free returns only the rows with no price', async () => {
    expect(await idsForTier('free')).toEqual(['f1', 'f2']);
  });

  it('under_50 returns only rows priced below HK$50 (5000 cents)', async () => {
    expect(await idsForTier('under_50')).toEqual(['u50a', 'u50b']);
  });

  it('under_200 returns only rows priced from HK$50 up to HK$200', async () => {
    expect(await idsForTier('under_200')).toEqual(['u200a', 'u200b']);
  });

  it('over_200 returns only rows priced HK$200 (20000 cents) or more', async () => {
    expect(await idsForTier('over_200')).toEqual(['o200a', 'o200b']);
  });

  it('does not show a HK$900 item under "Under HK$50"', async () => {
    // The symptom from the issue report, pinned as its own test.
    const ids = await idsForTier('under_50');
    expect(ids).not.toContain('o200b');
  });

  it('the four tiers partition the catalogue', async () => {
    const tiers = await Promise.all([
      idsForTier('free'),
      idsForTier('under_50'),
      idsForTier('under_200'),
      idsForTier('over_200'),
    ]);
    const [free, under50, under200, over200] = tiers;

    // Every row lands in exactly one tier.
    const union = new Set([...free, ...under50, ...under200, ...over200]);
    expect([...union].sort()).toEqual(ROWS.map((r) => r.id as string).sort());
    expect(union.size).toBe(
      free.length + under50.length + under200.length + over200.length,
    );

    // No tier overlaps another.
    for (let i = 0; i < tiers.length; i++) {
      for (let j = i + 1; j < tiers.length; j++) {
        expect(tiers[i].filter((id) => tiers[j].includes(id))).toEqual([]);
      }
    }
  });

  it('no price tier returns the whole catalogue', async () => {
    const result = await getCatalogFeed({});
    expect(result.gifts.length).toBe(ROWS.length);
  });

  it('applies the price bounds as AND-ed filters, never through .or()', async () => {
    await getCatalogFeed({ priceTier: 'under_50' });
    // A comma-joined `or()` is exactly the bug that shipped.
    expect(state.orCalls.filter((c) => c.includes('price_cents'))).toEqual([]);
  });
});

describe('catalog settlement currency (OOP-6714)', () => {
  it('reports one currency for every row in the feed', async () => {
    const result = await getCatalogFeed({});
    expect(result.gifts.length).toBeGreaterThan(0);
    expect([...new Set(result.gifts.map((g) => g.currency))]).toEqual(['hkd']);
  });

  it('reports one currency for every tier', async () => {
    for (const tier of ['free', 'under_50', 'under_200', 'over_200']) {
      const result = await getCatalogFeed({ priceTier: tier });
      for (const gift of result.gifts) {
        expect(gift.currency).toBe('hkd');
      }
    }
  });

  it('a row in another currency is reported in the settlement currency, and flagged', async () => {
    // A stray row means migration 0012 has not been applied and its
    // `price_cents` are in the wrong unit. The feed must not report a
    // second currency, and the server must say so.
    const stray = toRow({
      id: 'stray',
      title: 'A weekend in Paris',
      price_cents: 2500,
      currency: 'EUR',
    });
    ROWS.push(stray);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await getCatalogFeed({});
      const row = result.gifts.find((g) => g.id === 'stray');
      expect(row?.currency).toBe('hkd');
      expect(logged.mock.calls.flat().join(' ')).toContain('settlement currency');
    } finally {
      logged.mockRestore();
      ROWS.splice(ROWS.indexOf(stray), 1);
    }
  });
});

// ─── Cover images (OOP-6717) ───────────────────────────────────────────────

describe('catalog cover images (OOP-6717)', () => {
  /**
   * The bug: `hydrateFeedRow` read `cover_media_id` and threw it away, so
   * the feed carried no image field at all and /browse drew an emoji tile
   * for every listing — the catalogue looked like a template.
   */
  async function coverFor(partial: Row): Promise<string | null | undefined> {
    const row = toRow(partial);
    ROWS.push(row);
    try {
      const result = await getCatalogFeed({});
      return result.gifts.find((g) => g.id === row.id)?.cover_url;
    } finally {
      ROWS.splice(ROWS.indexOf(row), 1);
    }
  }

  it('resolves the cover from cover_media_id', async () => {
    const url = await coverFor({
      id: 'with-cover',
      cover_media_id: 'm1',
      cover: { id: 'm1', storage_path: 'gifts/catalogue/me/cover.jpg' },
    });
    expect(url).toBe('https://cdn.test/lovorithm-media/gifts/catalogue/me/cover.jpg');
  });

  it('falls back to the first photo in the payload', async () => {
    // The publish card treats the cover as optional, so a creator can
    // list a gift with photos in its payload and no cover of its own.
    const url = await coverFor({
      id: 'payload-cover',
      type: 'dragdrop_puzzle',
      payload: { grid: 4, photo_url: 'https://cdn.test/photo.jpg' },
    });
    expect(url).toBe('https://cdn.test/photo.jpg');
  });

  it('takes the first pair of a memory-cards payload', async () => {
    const url = await coverFor({
      id: 'memory-cover',
      type: 'memory_cards',
      payload: {
        pairs: [
          { caption: 'first', photo_url: 'https://cdn.test/one.jpg' },
          { caption: 'second', photo_url: 'https://cdn.test/two.jpg' },
        ],
      },
    });
    expect(url).toBe('https://cdn.test/one.jpg');
  });

  it('ignores a collage item that is not a photo', async () => {
    const url = await coverFor({
      id: 'collage-cover',
      type: 'multimedia_collage',
      payload: {
        media: [
          { type: 'audio', url: 'https://cdn.test/song.mp3' },
          { type: 'photo', url: 'https://cdn.test/street.jpg' },
        ],
      },
    });
    expect(url).toBe('https://cdn.test/street.jpg');
  });

  it('reports no cover for a gift with no photo at all', async () => {
    const url = await coverFor({
      id: 'no-cover',
      type: 'quiz',
      payload: { questions: [{ q: 'Where did we meet?', options: ['a', 'b'] }] },
    });
    expect(url).toBeNull();
  });
});

// ─── Like counts (OOP-6722) ────────────────────────────────────────────────

describe('like counts (OOP-6722)', () => {
  beforeEach(() => {
    state.rpcCalls.length = 0;
  });

  /**
   * Rows with a known number of likes: three, one, and none. The zero
   * case matters — it is the one where the aggregate embed and the RPC
   * could disagree about what "no likes" looks like.
   */
  const LIKED_ROWS: Row[] = [
    toRow({ id: 'liked-3', likes: [1, 2, 3] }),
    toRow({ id: 'liked-1', likes: [1] }),
    toRow({ id: 'liked-0', likes: [] }),
  ];

  /** Push the liked rows, run `body`, and take them out again. */
  async function withLikedRows<T>(body: () => Promise<T>): Promise<T> {
    ROWS.push(...LIKED_ROWS);
    try {
      return await body();
    } finally {
      ROWS.splice(ROWS.length - LIKED_ROWS.length, LIKED_ROWS.length);
    }
  }

  it('reads the like count from the aggregate embed, with no RPC per row', async () => {
    await withLikedRows(async () => {
      const result = await getCatalogFeed({});
      const liked = result.gifts.find((g) => g.id === 'liked-3');
      expect(liked?.like_count).toBe(3);

      // The whole feed used to cost 21 round trips — one `gift_like_count`
      // RPC per row. The aggregate embed replaces every one of them.
      expect(state.rpcCalls).toEqual([]);
    });
  });

  it('the aggregate like_count matches gift_like_count for the same gift', async () => {
    // The aggregate is a rewrite of the RPC, not a different number. This
    // is the guard that stops the rewrite silently changing the counts.
    await withLikedRows(async () => {
      const result = await getCatalogFeed({});
      const client = createFakeClient();
      expect(result.gifts.length).toBeGreaterThan(0);

      for (const gift of result.gifts) {
        const { data: rpcCount } = await client.rpc('gift_like_count', {
          gift_id: gift.id,
        });
        expect(gift.like_count).toBe(rpcCount);
      }
    });
  });

  it('the listing detail reads its like count from the aggregate too', async () => {
    const id = 'aaaa9999-0000-0000-0000-000000000001';
    await withLikedRows(async () => {
      ROWS.push(toRow({ id, likes: [1, 2] }));
      try {
        const listing = await getListingDetail(id);
        expect(listing?.like_count).toBe(2);
        expect(state.rpcCalls).toEqual([]);
      } finally {
        ROWS.splice(ROWS.length - 1, 1);
      }
    });
  });
});

// ─── Feed pagination (OOP-6730) ────────────────────────────────────────────

/**
 * A catalogue bigger than one feed page — 25 listings, newest first.
 *
 * The published_at values use the format Postgres actually returns
 * (`2026-08-25T07:41:25.954751+00:00`), because the cursor is built
 * from them: that timestamp is 32 characters, and with the UUID the
 * cursor is base64url of 69 bytes — 92 characters. The schema that has
 * to read the cursor back used to cap it at 80, so EVERY cursor the
 * feed handed out was rejected and page 2 came back empty.
 */
function pagedCatalogue(): Row[] {
  return Array.from({ length: 25 }, (_, i) =>
    toRow({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      title: `Listing ${i}`,
      published_at: `2026-08-${String(25 - i).padStart(2, '0')}T07:41:25.954751+00:00`,
      owner: {
        id: 'p1',
        handle: i % 2 === 0 ? 'ada' : 'mei',
        display_name: 'Ada',
      },
    }),
  );
}

/**
 * Walk the feed with its own cursor, the way the sitemap does.
 */
async function walkFeed(): Promise<Row[]> {
  const seen: Row[] = [];
  let cursor: string | undefined;
  for (;;) {
    const { gifts, nextCursor } = await getCatalogFeed(
      { sort: 'published_desc', cursor },
      { pageSize: 20 },
    );
    seen.push(...gifts);
    if (!nextCursor) return seen;
    cursor = nextCursor;
  }
}

describe('feed pagination (OOP-6730)', () => {
  beforeEach(() => {
    state.rows = pagedCatalogue();
  });

  afterEach(() => {
    state.rows = null;
  });

  it('hands out a cursor the feed accepts back', async () => {
    const first = await getCatalogFeed({ sort: 'published_desc' });

    expect(first.gifts).toHaveLength(20);
    expect(first.nextCursor).toBeTruthy();

    // The cursor is 92 characters — longer than the 80 the schema used
    // to allow, which is why page 2 used to be empty.
    expect(first.nextCursor!.length).toBeGreaterThan(80);

    const second = await getCatalogFeed({
      sort: 'published_desc',
      cursor: first.nextCursor,
    });

    expect(second.gifts.length).toBeGreaterThan(0);
  });

  it('walks the whole catalogue without dropping a listing', async () => {
    const gifts = await walkFeed();

    // Every listing, exactly once — the page boundary used to swallow
    // one row: the cursor anchored on the OVERFLOW row, which had been
    // sliced off the page and was then excluded by the next page's
    // strict `<` filter.
    const ids = gifts.map((g) => g.id);
    expect(ids).toHaveLength(25);
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual(pagedCatalogue().map((r) => r.id));
  });

  it('the oldest listing is on the last page', async () => {
    const gifts = await walkFeed();

    expect(gifts[gifts.length - 1].id).toBe(
      '00000000-0000-0000-0000-000000000024',
    );
    expect(gifts[gifts.length - 1].published_at).toBe(
      '2026-08-01T07:41:25.954751+00:00',
    );
  });
});
