import { formatSettlementAmount } from '@/lib/money';

/**
 * Price badge markup, with the "Free" label passed in.
 *
 * Split out of `PriceBadge` so the same markup can be rendered by a server
 * component (which resolves the label with `getTranslations`) or by a client
 * component (which resolves it with `useTranslations`). OOP-6710: the /browse
 * grid is fetched on the client, so its cards are client components — but the
 * pages that render a price badge from the server (`/l/[giftId]`,
 * `/checkout/[giftId]`) should not have to ship client JS for it.
 *
 * OOP-6714: there is no currency prop. The marketplace settles in one
 * currency (HKD), so the amount is always HKD cents and the badge always
 * says so — a badge that could render three different currencies is the
 * bug this replaced.
 */
type Props = {
  priceCents: number | null;
  /** Resolved "Free" label. */
  freeLabel: string;
};

export function PriceBadgeView({ priceCents, freeLabel }: Props) {
  if (priceCents == null) {
    return (
      <span className="lb-price-badge lb-price-badge--free">
        {freeLabel}
      </span>
    );
  }

  return (
    <span className="lb-price-badge lb-price-badge--paid">
      {formatSettlementAmount(priceCents)}
    </span>
  );
}
