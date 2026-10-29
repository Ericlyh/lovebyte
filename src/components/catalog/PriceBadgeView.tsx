/**
 * Price badge markup, with the "Free" label passed in.
 *
 * Split out of `PriceBadge` so the same markup can be rendered by a server
 * component (which resolves the label with `getTranslations`) or by a client
 * component (which resolves it with `useTranslations`). OOP-6710: the /browse
 * grid is fetched on the client, so its cards are client components — but
 * the pages that render a price badge from the server (`/l/[giftId]`,
 * `/checkout/[giftId]`) should not have to ship client JS for it.
 */
type Props = {
  priceCents: number | null;
  currency: string | null;
  /** Resolved "Free" label. */
  freeLabel: string;
};

export function PriceBadgeView({ priceCents, currency, freeLabel }: Props) {
  if (priceCents == null) {
    return (
      <span className="lb-price-badge lb-price-badge--free">
        {freeLabel}
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
