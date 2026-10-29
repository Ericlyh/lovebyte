import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCatalogFeed } from './catalog';

/**
 * Regression tests for the catalogue price-tier filter (OOP-6713).
 *
 * The bug: `priceTierPredicate` packed a tier's bounds into ONE
 * comma-joined PostgREST string (`price_cents.gte.1,price_cents.lt.500`)
 * and handed it to `.or()`. PostgREST reads `or=(a,b)` as two OR'd
 * conditions, so the filter was really `(price >= 1) OR (price < 500)` —
 * true for every paid row. Every paid tier therefore returned the whole
 * catalogue, and "Under $5" showed a $120 item.
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
 * Prices sit exactly on the band edges on purpose (499/500/1999/2000) so
 * an off-by-one in either bound fails a test.
 */
const CATALOGUE: Row[] = [
  { id: 'f1', title: 'Free note', price_cents: null, currency: 'USD' },
  { id: 'f2', title: 'Free quiz', price_cents: null, currency: 'HKD' },
  { id: 'u5a', title: 'Ninety-nine cents', price_cents: 99, currency: 'USD' },
  { id: 'u5b', title: 'Four ninety-nine', price_cents: 499, currency: 'USD' },
  { id: 'u20a', title: 'Five dollars', price_cents: 500, currency: 'USD' },
  { id: 'u20b', title: 'Nineteen ninety-nine', price_cents: 1999, currency: 'EUR' },
  { id: 'o20a', title: 'Twenty dollars', price_cents: 2000, currency: 'USD' },
  { id: 'o20b', title: 'One twenty', price_cents: 12000, currency: 'USD' },
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
    payload: null,
    deleted_at: null,
    is_listed: true,
    published_at: '2026-10-01T00:00:00.000Z',
    owner: { id: 'p1', handle: 'ada', display_name: 'Ada' },
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
  const c = compare(value, op === 'lt' || op === 'lte' || op === 'gt' || op === 'gte' ? Number(raw) : raw);
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
    return rows;
  }
}

// ─── The mocked Supabase clients ───────────────────────────────────────────

const state = vi.hoisted(() => ({
  orCalls: [] as string[],
}));

function createFakeClient() {
  return {
    from(table: string) {
      return new FakeQueryBuilder(table === 'profiles_public' ? PROFILES : ROWS, state.orCalls);
    },
    /** `gift_like_count` — the fake reports no likes. */
    rpc() {
      return Promise.resolve({ data: 0, error: null });
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

  it('under_5 returns only rows priced below 500 cents', async () => {
    expect(await idsForTier('under_5')).toEqual(['u5a', 'u5b']);
  });

  it('under_20 returns only rows priced from 500 up to 2000 cents', async () => {
    expect(await idsForTier('under_20')).toEqual(['u20a', 'u20b']);
  });

  it('over_20 returns only rows priced 2000 cents or more', async () => {
    expect(await idsForTier('over_20')).toEqual(['o20a', 'o20b']);
  });

  it('does not show a $120 item under "Under $5"', async () => {
    // The symptom from the issue report, pinned as its own test.
    const ids = await idsForTier('under_5');
    expect(ids).not.toContain('o20b');
  });

  it('the four tiers partition the catalogue', async () => {
    const tiers = await Promise.all([
      idsForTier('free'),
      idsForTier('under_5'),
      idsForTier('under_20'),
      idsForTier('over_20'),
    ]);
    const [free, under5, under20, over20] = tiers;

    // Every row lands in exactly one tier.
    const union = new Set([...free, ...under5, ...under20, ...over20]);
    expect([...union].sort()).toEqual(ROWS.map((r) => r.id as string).sort());
    expect(union.size).toBe(free.length + under5.length + under20.length + over20.length);

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
    await getCatalogFeed({ priceTier: 'under_5' });
    // A comma-joined `or()` is exactly the bug that shipped.
    expect(state.orCalls.filter((c) => c.includes('price_cents'))).toEqual([]);
  });
});
