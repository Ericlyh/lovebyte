import { getTranslations } from 'next-intl/server';

/**
 * Price badge for /browse cards + /l/[giftId] hero (M-C, OOP-4275).
 *
 * Two visual states:
 *   • Free / contact     → soft sage pill ("Free" or "Pay what you want")
 *   • Paid (cents > 0)   → currency-formatted amount
 *
 * `priceCents=null` is "Free / contact creator" per the M-A constants.
 * `priceCents > 0` formats with `Intl.NumberFormat` using the gift's own
 * currency (HKD/USD/EUR show up in the seed).
 */
type Props = {
  priceCents: number | null;
  currency: string | null;
};

export async function PriceBadge({ priceCents, currency }: Props) {
  const t = await getTranslations('Catalog.price');

  if (priceCents == null) {
    return (
      <span className="lb-price-badge lb-price-badge--free">
        {t('free')}
      </span>
    );
  }

  // Defensive: if currency is missing or unknown, fall back to plain cents.
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency ?? 'USD',
      maximumFractionDigits: 0,
    }).format(priceCents / 100);
  } catch {
    formatted = `${priceCents / 100}`;
  }

  return (
    <span className="lb-price-badge lb-price-badge--paid">{formatted}</span>
  );
}
