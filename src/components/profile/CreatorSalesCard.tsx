import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { formatSettlementAmount } from '@/lib/money';
import type { CreatorSalesSummary } from '@/lib/profiles/sales';

/**
 * The creator's sales figures (OOP-6719).
 *
 * Rendered on the creator's own profile, and only for the owner — the
 * RLS on `purchases` would hide the rows from anyone else anyway, but
 * the section is not even fetched for a visitor.
 *
 * Three numbers, because a seller needs all three:
 *
 *   gross  — what buyers paid. This is the size of the business.
 *   net    — what the creator actually keeps. This is the number that
 *            decides whether creating another gift is worth it.
 *   units  — how many sales. This is the number that says whether the
 *            business is one lucky purchase or a habit.
 *
 * The platform fee is the difference between the first two, and it is
 * spelled out rather than left for the reader to work out.
 */
type Props = {
  summary: CreatorSalesSummary;
};

export async function CreatorSalesCard({ summary }: Props) {
  const t = await getTranslations('Profile.sales');

  return (
    <div className="lb-sales-card">
      <dl className="lb-sales-stats">
        <div className="lb-sales-stat">
          <dt className="lb-sales-stat__label">{t('grossSales')}</dt>
          <dd className="lb-sales-stat__value">
            {formatSettlementAmount(summary.grossCents)}
          </dd>
        </div>
        <div className="lb-sales-stat">
          <dt className="lb-sales-stat__label">{t('netEarnings')}</dt>
          <dd className="lb-sales-stat__value lb-sales-stat__value--net">
            {formatSettlementAmount(summary.netCents)}
          </dd>
        </div>
        <div className="lb-sales-stat">
          <dt className="lb-sales-stat__label">{t('unitsSold')}</dt>
          <dd className="lb-sales-stat__value">
            {t('unitsCount', { count: summary.unitsSold })}
          </dd>
        </div>
      </dl>

      <p className="lb-sales-note">{t('note')}</p>

      <div className="lb-sales-actions">
        <Link href="/purchases" className="lb-btn lb-btn--primary lb-btn--sm">
          {t('viewPurchases')} →
        </Link>
      </div>
    </div>
  );
}
