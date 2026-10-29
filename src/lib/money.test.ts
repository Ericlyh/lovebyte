import { describe, expect, it } from 'vitest';
import {
  PLATFORM_FEE_BPS_DEFAULT,
  PRICE_TIER_LOWER_CENTS,
  PRICE_TIER_UPPER_CENTS,
  SETTLEMENT_CURRENCY,
  SETTLEMENT_CURRENCY_DB,
  formatSettlementAmount,
  platformFeeCents,
} from './money';

/**
 * Settlement-money tests (OOP-6714).
 *
 * The catalogue used to carry HKD, USD and EUR behind dollar-denominated
 * filter bands, and the platform fee was computed on three different
 * bases. These tests pin the three things that fix that:
 *
 *   1. there is exactly one currency;
 *   2. the price-tier bands are edges in that currency;
 *   3. the platform fee is computed on the settlement amount, with a
 *      stated rounding rule.
 */

describe('settlement currency (OOP-6714)', () => {
  it('settles in HKD', () => {
    expect(SETTLEMENT_CURRENCY).toBe('hkd');
    expect(SETTLEMENT_CURRENCY_DB).toBe('HKD');
  });

  it('stores the upper-case code the char(3) column expects', () => {
    expect(SETTLEMENT_CURRENCY_DB).toHaveLength(3);
    expect(SETTLEMENT_CURRENCY_DB).toBe(SETTLEMENT_CURRENCY.toUpperCase());
  });
});

describe('price-tier bands (OOP-6714)', () => {
  it('are expressed in HKD cents, not dollars', () => {
    expect(PRICE_TIER_LOWER_CENTS).toBe(5000); // HK$50
    expect(PRICE_TIER_UPPER_CENTS).toBe(20000); // HK$200
  });

  it('orders the two edges', () => {
    expect(PRICE_TIER_LOWER_CENTS).toBeLessThan(PRICE_TIER_UPPER_CENTS);
  });
});

describe('platformFeeCents (OOP-6714)', () => {
  it('takes the stated percentage of the settlement amount', () => {
    expect(platformFeeCents(10000, 1000)).toBe(1000); // 10% of HK$100
    expect(platformFeeCents(10000, 1500)).toBe(1500); // 15%
    expect(platformFeeCents(10000, 500)).toBe(500); // 5% floor
  });

  it('rounds DOWN to the nearest cent, leaving the remainder with the creator', () => {
    // 10% of HK$18.37 is HK$1.837 → HK$1.83, not HK$1.84.
    expect(platformFeeCents(1837, 1000)).toBe(183);
    // 10% of HK$1.01 is HK$0.101 → HK$0.10.
    expect(platformFeeCents(101, 1000)).toBe(10);
    // 10% of HK$0.09 is HK$0.009 → nothing.
    expect(platformFeeCents(9, 1000)).toBe(0);
  });

  it('keeps the fee plus the payout equal to the amount charged', () => {
    for (const amount of [1, 99, 101, 1837, 21837, 94141]) {
      const fee = platformFeeCents(amount, PLATFORM_FEE_BPS_DEFAULT);
      expect(fee + (amount - fee)).toBe(amount);
      expect(fee).toBeLessThanOrEqual(amount);
    }
  });

  it('never returns a negative fee', () => {
    expect(platformFeeCents(0, 1000)).toBe(0);
    expect(platformFeeCents(-100, 1000)).toBe(0);
  });
});

describe('formatSettlementAmount (OOP-6714)', () => {
  it('renders HKD, never a bare dollar sign', () => {
    expect(formatSettlementAmount(1800)).toBe('HK$18');
    expect(formatSettlementAmount(4800)).toBe('HK$48');
  });

  it('keeps the cents when the amount has them', () => {
    expect(formatSettlementAmount(21837)).toBe('HK$218.37');
    expect(formatSettlementAmount(94141)).toBe('HK$941.41');
  });

  it('never names another currency', () => {
    for (const amount of [0, 1, 1800, 21837, 94141]) {
      expect(formatSettlementAmount(amount)).toContain('HK$');
      expect(formatSettlementAmount(amount)).not.toMatch(/US\$|€|£/);
    }
  });
});
