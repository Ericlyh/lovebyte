import { getTranslations } from 'next-intl/server';
import { PriceBadgeView } from './PriceBadgeView';

/**
 * Price badge for /browse cards + /l/[giftId] hero (M-C, OOP-4275).
 *
 * Two visual states:
 *   • Free / contact     → soft sage pill ("Free" or "Pay what you want")
 *   • Paid (cents > 0)   → currency-formatted amount
 *
 * `priceCents=null` is "Free / contact creator" per the M-A constants.
 * `priceCents > 0` formats with `Intl.NumberFormat` — always in the
 * settlement currency, HKD (OOP-6714). The marketplace used to format in
 * each gift's own currency, so the same browse page could show HK$48, €25
 * and US$120 side by side behind filters written in dollars.
 */
type Props = {
  priceCents: number | null;
};

export async function PriceBadge({ priceCents }: Props) {
  const t = await getTranslations('Catalog.price');

  return <PriceBadgeView priceCents={priceCents} freeLabel={t('free')} />;
}
