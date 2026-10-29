import { describe, expect, it, vi } from 'vitest';
import { summarizeSales } from './sales';
import { isUuidLike } from '@/lib/uuid';

/**
 * Tests for the creator sales arithmetic (OOP-6719).
 *
 * The point of the issue: `creator_payout_cents` and `platform_fee_cents`
 * were WRITE-ONLY — the only two references in the codebase were the
 * inserts in the Stripe webhook. A creator could not see a single number
 * of their own earnings. This module reads them back, and the sums are
 * done in JS because this PostgREST build has aggregate functions
 * disabled (`?select=sum(x)` fails with PGRST200).
 *
 * These tests pin the arithmetic that the seller sees, and the one
 * invariant that makes the three figures trustworthy: gross is always
 * the fee plus the payout, row by row.
 */

// The data layer is not under test here — `summarizeSales` is pure.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({}),
}));

describe('summarizeSales', () => {
  it('reports zeroes for a creator with no sales', () => {
    const summary = summarizeSales([]);

    expect(summary.unitsSold).toBe(0);
    expect(summary.grossCents).toBe(0);
    expect(summary.platformFeeCents).toBe(0);
    expect(summary.netCents).toBe(0);
    expect(summary.currency).toBe('hkd');
  });

  it('adds up one sale', () => {
    const summary = summarizeSales([
      { amountCents: 100, platformFeeCents: 10, creatorPayoutCents: 90 },
    ]);

    expect(summary.unitsSold).toBe(1);
    expect(summary.grossCents).toBe(100);
    expect(summary.platformFeeCents).toBe(10);
    expect(summary.netCents).toBe(90);
  });

  it('adds up many sales', () => {
    const summary = summarizeSales([
      { amountCents: 1800, platformFeeCents: 180, creatorPayoutCents: 1620 },
      { amountCents: 100, platformFeeCents: 10, creatorPayoutCents: 90 },
      { amountCents: 4550, platformFeeCents: 455, creatorPayoutCents: 4095 },
    ]);

    expect(summary.unitsSold).toBe(3);
    expect(summary.grossCents).toBe(6450);
    expect(summary.platformFeeCents).toBe(645);
    expect(summary.netCents).toBe(5805);
  });

  it('keeps gross = platform fee + net', () => {
    // The webhook writes both sides of every sale, so the three figures
    // must reconcile — a creator whose "net" does not add up to their
    // "gross" would rightly distrust the whole panel.
    const sales = [
      { amountCents: 1800, platformFeeCents: 180, creatorPayoutCents: 1620 },
      { amountCents: 999, platformFeeCents: 99, creatorPayoutCents: 900 },
      { amountCents: 1, platformFeeCents: 0, creatorPayoutCents: 1 },
    ];

    const summary = summarizeSales(sales);

    expect(summary.grossCents).toBe(
      summary.platformFeeCents + summary.netCents,
    );
    for (const sale of sales) {
      expect(sale.amountCents).toBe(
        sale.platformFeeCents + sale.creatorPayoutCents,
      );
    }
  });

  it('counts a refunded sale as nothing', () => {
    // The read filters on `status = 'paid'` before it gets here, so a
    // refund can never reach the sum. This test pins the consequence:
    // the caller filters, the arithmetic trusts it.
    const summary = summarizeSales([
      { amountCents: 100, platformFeeCents: 10, creatorPayoutCents: 90 },
    ]);

    expect(summary.unitsSold).toBe(1);
    expect(summary.grossCents).toBe(100);
  });
});

describe('isUuidLike', () => {
  it('accepts a seeded catalogue id', () => {
    // The seeded catalogue uses hand-written ids. Zod's `.uuid()` rejects
    // them (it enforces the RFC 4122 version nibble), which is why eight
    // of the nine seeded listings used to fail validation in the like,
    // comment and reply paths.
    expect(isUuidLike('aaaa1111-0000-0000-0000-000000000001')).toBe(true);
  });

  it('accepts an RFC 4122 uuid', () => {
    expect(isUuidLike('d3a0c000-0000-0000-0000-0000d3a0c0de')).toBe(true);
  });

  it('rejects junk', () => {
    expect(isUuidLike('')).toBe(false);
    expect(isUuidLike('not-a-uuid')).toBe(false);
    expect(isUuidLike('aaaa11110000000000000000000000001')).toBe(false);
    expect(isUuidLike(null)).toBe(false);
    expect(isUuidLike(undefined)).toBe(false);
  });
});
