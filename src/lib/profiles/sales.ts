import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { SETTLEMENT_CURRENCY } from '@/lib/money';
import { isUuidLike } from '@/lib/uuid';

/**
 * Creator sales figures (OOP-6719).
 *
 * A creator could see their listings but never their takings: the RLS
 * already granted a seller SELECT on their own `purchases` rows
 * (`purchases_select_buyer_or_seller`, migration 0002), but nothing in
 * the app ever read them — `creator_payout_cents` and `platform_fee_cents`
 * were write-only, touched only by the Stripe webhook. A seller who
 * cannot measure their storefront has no reason to keep it, which is
 * what this module exists to fix.
 *
 * Three numbers, all in the settlement currency (HKD):
 *
 *   gross       — what buyers paid (`amount_cents`).
 *   platform fee— the platform's cut (`platform_fee_cents`).
 *   net         — what the creator keeps (`creator_payout_cents`).
 *
 * `gross = fee + net` holds row by row (the webhook writes both sides),
 * so the three always add up.
 *
 * Only `status = 'paid'` rows count. A refunded purchase is not a sale:
 * it would inflate the gross and the units, and the creator has already
 * lost the money.
 *
 * ## Why the seller filter is an embedded-resource filter
 *
 * `purchases` has no `seller_id` column — the seller is the OWNER of the
 * purchased gift, so the row has to be found by joining to `gifts`. The
 * query embeds `gifts!inner` and filters on `gift.owner_id`, which
 * PostgREST turns into an inner join on the gift's owner.
 *
 * RLS does the authorisation, not this code: `purchases_select_buyer_or_seller`
 * lets a row through when the caller is the buyer OR the owner of the
 * purchased gift. Reading somebody else's sales therefore returns zero
 * rows, whatever filter this module is handed — the profile page gates
 * the section on `viewerIsOwner` as well, but the database is the real
 * boundary.
 *
 * ## Why the sums are computed in JS
 *
 * This PostgREST build has aggregate functions disabled — `?select=sum(x)`
 * fails with PGRST200 ("Could not find a relationship between 'purchases'
 * and 'sum'"). So the three column values come back as rows and are added
 * up here. The exact COUNT of matching sales still comes from PostgREST
 * (`count: 'exact'`), because that is a header, not an aggregate.
 */

/**
 * How many sale rows we pull to sum up.
 *
 * PostgREST caps a response at its own `max-rows` setting; we ask for
 * this many and the server may still trim. `SALES_ROW_LIMIT` only bounds
 * the SUM; the units-sold count is exact regardless (it comes from
 * `count: 'exact'`), so a truncated window under-reports the money, not
 * the number of sales.
 */
const SALES_ROW_LIMIT = 1000;

/** The three money columns of one sale, already normalised. */
export type SaleAmounts = {
  amountCents: number;
  platformFeeCents: number;
  creatorPayoutCents: number;
};

export type CreatorSalesSummary = {
  /** How many paid sales the creator has made. */
  unitsSold: number;
  /** Total the buyers paid, before the platform's cut. */
  grossCents: number;
  /** The platform's cut across those sales. */
  platformFeeCents: number;
  /** What the creator keeps. `grossCents - platformFeeCents`. */
  netCents: number;
  /** Always the settlement currency (OOP-6714). */
  currency: string;
};

export type CreatorSale = {
  id: string;
  giftId: string;
  giftTitle: string;
  amountCents: number;
  platformFeeCents: number;
  creatorPayoutCents: number;
  createdAt: string;
};

export type CreatorSales = {
  summary: CreatorSalesSummary;
  sales: CreatorSale[];
};

/** Raw row shape as PostgREST returns it. */
type SaleRow = {
  id: string;
  gift_id: string;
  amount_cents: number | null;
  platform_fee_cents: number | null;
  creator_payout_cents: number | null;
  created_at: string;
  gift: { id: string; title: string } | { id: string; title: string }[] | null;
};

const salesSelect =
  'id, gift_id, amount_cents, platform_fee_cents, creator_payout_cents, created_at, ' +
  'gift:gifts!inner(id, title)';

const EMPTY_SUMMARY: CreatorSalesSummary = {
  unitsSold: 0,
  grossCents: 0,
  platformFeeCents: 0,
  netCents: 0,
  currency: SETTLEMENT_CURRENCY,
};

/**
 * Add up a set of sales. Pure, so the arithmetic is testable without a
 * database.
 *
 * `unitsSold` counts the rows given — one purchase is one unit.
 */
export function summarizeSales(sales: SaleAmounts[]): CreatorSalesSummary {
  let unitsSold = 0;
  let grossCents = 0;
  let platformFeeCents = 0;
  let netCents = 0;

  for (const sale of sales) {
    unitsSold += 1;
    grossCents += sale.amountCents;
    platformFeeCents += sale.platformFeeCents;
    netCents += sale.creatorPayoutCents;
  }

  return { unitsSold, grossCents, platformFeeCents, netCents, currency: SETTLEMENT_CURRENCY };
}

function toAmounts(row: SaleRow): SaleAmounts {
  return {
    amountCents: row.amount_cents ?? 0,
    platformFeeCents: row.platform_fee_cents ?? 0,
    creatorPayoutCents: row.creator_payout_cents ?? 0,
  };
}

function toSale(row: SaleRow): CreatorSale {
  const gift = Array.isArray(row.gift) ? row.gift[0] : row.gift;
  return {
    id: row.id,
    giftId: row.gift_id,
    giftTitle: gift?.title ?? '',
    amountCents: row.amount_cents ?? 0,
    platformFeeCents: row.platform_fee_cents ?? 0,
    creatorPayoutCents: row.creator_payout_cents ?? 0,
    createdAt: row.created_at,
  };
}

/**
 * The creator's sales — the summary figures and the individual sales.
 *
 * Returns zeroes when `creatorId` is not a uuid, and zeroes with a logged
 * error when the read fails: a creator with no sales and a creator whose
 * sales could not be loaded should not look the same, but neither should
 * take down the profile page. The profile renders the section only for
 * the owner, so a failed read shows "no sales yet" rather than a 500.
 */
export async function getCreatorSales(creatorId: string): Promise<CreatorSales> {
  if (!isUuidLike(creatorId)) {
    return { summary: { ...EMPTY_SUMMARY }, sales: [] };
  }

  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from('purchases')
    .select(salesSelect, { count: 'exact' })
    .eq('gift.owner_id', creatorId)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(SALES_ROW_LIMIT);

  if (error) {
    console.error('[profiles/getCreatorSales] read failed', error.message);
    return { summary: { ...EMPTY_SUMMARY }, sales: [] };
  }

  // `gift:gifts!inner(...)` is a PostgREST embed hint that supabase-js's
  // select-type resolver does not understand, so it falls back to
  // `GenericStringError` and the rows have to be asserted. The shape is
  // pinned by `salesSelect` above.
  const rows = (data ?? []) as unknown as SaleRow[];
  const summary = summarizeSales(rows.map(toAmounts));

  // PostgREST's exact count is the true number of paid sales even when
  // the response window trimmed the rows. Prefer it for the headline
  // "units sold" figure; the money sums cover the rows we actually read.
  if (typeof count === 'number' && count > summary.unitsSold) {
    summary.unitsSold = count;
  }

  return { summary, sales: rows.map(toSale) };
}
