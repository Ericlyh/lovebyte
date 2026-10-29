/**
 * Settlement money (OOP-6714).
 *
 * The marketplace settles in ONE currency: HKD (Hong Kong dollars).
 *
 * Before this module the catalogue carried three currencies (HKD, USD, EUR)
 * behind filter labels written in dollars, and the Stripe `price_data`
 * took whatever `gifts.currency` happened to say — so the price-tier
 * thresholds, the platform fee and the amount charged to the buyer were
 * all computed on different bases. A marketplace cannot settle that way:
 * you cannot refund, reconcile or re-price a catalogue that does not
 * have one unit of account.
 *
 * The rules this module encodes:
 *
 *   1. `SETTLEMENT_CURRENCY` is the only currency. Every price, filter
 *      band, platform fee and Stripe amount is in it. There is no runtime
 *      FX conversion — a price is stored and settled in the unit it is
 *      shown in.
 *   2. The one-off conversion of the legacy USD/EUR catalogue rows is a
 *      DATA migration (see `supabase/migrations/0012_settlement_currency_hkd.sql`),
 *      not a runtime concern. By the time it has run, every stored
 *      `price_cents` is already HKD cents.
 *   3. The platform fee is computed on the settlement amount and
 *      rounded DOWN to the nearest cent, so the platform never skims a
 *      fraction of a cent and the sub-cent remainder stays with the
 *      creator.
 *
 * This module is imported by client components (the price badge), so it
 * must stay free of server-only imports.
 */

/**
 * Wire format — ISO-4217 lower case. This is what Stripe's
 * `price_data.currency` wants and what the JSON API returns.
 */
export const SETTLEMENT_CURRENCY = 'hkd';

/**
 * Storage format — `gifts.currency` is `char(3)`, so the column holds
 * the upper-case code ('HKD'). Keep the two in sync when changing either.
 */
export const SETTLEMENT_CURRENCY_DB = 'HKD';

/** The symbol buyers see. `Intl` renders HKD as "HK$" in en-US. */
export const SETTLEMENT_CURRENCY_SYMBOL = 'HK$';

/**
 * Platform fee bounds, in basis points (500 = 5%, 10000 = 100%).
 * These mirror the `gifts_platform_fee_bps_chk` CHECK constraint added in
 * migration 0002; the app enforces the same bounds so a bad value never
 * reaches the database.
 */
export const PLATFORM_FEE_BPS_MIN = 500;
export const PLATFORM_FEE_BPS_MAX = 10000;
export const PLATFORM_FEE_BPS_DEFAULT = 1000;

/**
 * Price-tier band edges, in HKD cents.
 *
 * The tiers are a browse filter, so the edges are round numbers a buyer
 * can hold in their head: HK$50 and HK$200. They used to be 500 / 2000
 * cents read as US dollars, which put a HK$48 item and a €25 item in the
 * same band as a US$120 item.
 */
export const PRICE_TIER_LOWER_CENTS = 5000;
export const PRICE_TIER_UPPER_CENTS = 20000;

/**
 * The platform's cut of a settled amount, in cents.
 *
 * ROUNDING RULE: the fee is truncated (rounded DOWN) to the nearest
 * whole cent, and the remainder stays with the creator. The platform
 * never charges a fraction of a cent, and the creator never loses one
 * to rounding. The amount, the fee and the creator payout are all in
 * the settlement currency (HKD cents), so they always add up:
 *
 *     fee     = floor(amount_cents * platform_fee_bps / 10000)
 *     payout  = amount_cents - fee
 *
 * `floor` (not `round`) is deliberate: a 10% fee on HK$18.37 is
 * HK$1.837, and the platform takes HK$1.83 while the creator keeps
 * HK$16.54.
 */
export function platformFeeCents(amountCents: number, feeBps: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  const bps = Number.isFinite(feeBps) ? feeBps : PLATFORM_FEE_BPS_DEFAULT;
  return Math.floor((amountCents * bps) / 10000);
}

/**
 * Format a settlement amount for display: "HK$18", "HK$218.37".
 *
 * The fraction digits appear only when the amount has them, so a whole
 * price reads as "HK$18" rather than "HK$18.00". The amount is always
 * interpreted as HKD cents — there is no currency argument, because
 * there is only one currency.
 */
export function formatSettlementAmount(amountCents: number): string {
  const hasFraction = Math.abs(amountCents) % 100 !== 0;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: SETTLEMENT_CURRENCY,
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    // Defensive: an unknown currency code would make Intl throw. We
    // cannot get here with a constant currency, but a bad locale or a
    // stripped ICU build would take the whole page down otherwise.
    return `${SETTLEMENT_CURRENCY_SYMBOL}${(amountCents / 100).toFixed(2)}`;
  }
}
