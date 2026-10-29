import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { CreatorSalesCard } from '@/components/profile/CreatorSalesCard';
import { createClient } from '@/lib/supabase/server';
import { getCreatorSales } from '@/lib/profiles/sales';
import { formatSettlementAmount } from '@/lib/money';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Purchases — ${BRAND.NAME}`,
};

/**
 * /purchases — the signed-in user's marketplace activity (M-E, OOP-4277).
 *
 * Two sides, because a signed-in user can be both:
 *
 *   • **Sales you made** — every purchase of the user's own gifts, with
 *     the gross amount, the platform's cut and what the creator keeps.
 *     This is the seller half of the same ledger, and it is the reason
 *     the page is reachable from the nav (OOP-6719): a creator who
 *     cannot see their takings has no reason to keep a storefront. The
 *     section only renders when there IS a sale, so a pure buyer never
 *     sees it.
 *
 *   • **Gifts you bought** — every purchase the user made, newest
 *     first. For `delivery_mode = 'buyer_shares'` purchases this is the
 *     canonical place to grab the share token. For `send_to_recipient`
 *     purchases the buyer may also see the link here (they paid; they
 *     can re-share).
 *
 * RLS-permitted via the existing `purchases_select_buyer_or_seller`
 * policy (`0002_marketplace_v2_rls.sql`) — the buyer can SELECT their own
 * rows, and so can the owner of the purchased gift.
 *
 * Reads happen through the user-context server client so RLS applies.
 * Service-role is not used here.
 */
export default async function PurchasesPage({ params }: PageProps<'/[locale]/purchases'>) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('Purchases');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/purchases');

  const { data: rows, error } = await supabase
    .from('purchases')
    .select(
      'id, share_id, status, amount_cents, currency, delivery_mode, recipient_contact, created_at, gift:gifts(id, title)',
    )
    .eq('buyer_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[purchases] list read failed', error.message);
  }

  // The seller's half of the ledger. `user.id` is the profile id (the
  // `profiles` row is keyed by the auth user), which is what
  // `gifts.owner_id` points at.
  const sales = await getCreatorSales(user.id);

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />
      <section className="lb-onboarding-card">
        <h1>{t('title')}</h1>

        {error ? (
          <p role="alert" className="lb-form__error">
            {t('loadError')}
          </p>
        ) : null}

        {sales.sales.length > 0 ? (
          <section
            className="lb-purchases-sales"
            aria-labelledby="lb-purchases-sales-title"
          >
            <h2 id="lb-purchases-sales-title" className="lb-purchases-section__title">
              {t('salesTitle')}
            </h2>
            <CreatorSalesCard summary={sales.summary} />
            <ul className="lb-purchases-list">
              {sales.sales.map((sale) => (
                <li key={sale.id} className="lb-purchase-row">
                  <div className="lb-purchase-row__copy">
                    <p className="lb-purchase-row__title">{sale.giftTitle}</p>
                    <p className="lb-purchase-row__meta">
                      <span className="lb-purchase-row__status--paid">
                        {t('saleGross', {
                          amount: formatSettlementAmount(sale.amountCents),
                        })}
                      </span>
                      {' · '}
                      {t('saleNet', {
                        amount: formatSettlementAmount(sale.creatorPayoutCents),
                      })}
                      {' · '}
                      {new Date(sale.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section
          className="lb-purchases-bought"
          aria-labelledby="lb-purchases-bought-title"
        >
          <h2 id="lb-purchases-bought-title" className="lb-purchases-section__title">
            {t('boughtTitle')}
          </h2>

          {!rows || rows.length === 0 ? (
            // Phase 9 (OOP-4225) — typed empty-state card instead of a
            // bare <p>. Same .lb-empty-card geometry as /u/[handle]
            // (slice 2) and /g/[token] (slice 1) so all three surfaces
            // speak the same visual language. CTA points to /browse
            // since buyers who haven't bought anything yet are
            // probably browsing.
            <div className="lb-empty-card" role="status">
              <div className="lb-empty-card__icon" aria-hidden="true">🛍️</div>
              <h3 className="lb-empty-card__title">{t('emptyTitle')}</h3>
              <p className="lb-empty-card__body">{t('empty')}</p>
              <div className="lb-empty-card__actions">
                <Link href="/browse" className="lb-btn lb-btn--primary">
                  {t('browseMore')}
                </Link>
              </div>
            </div>
          ) : (
            <ul className="lb-purchases-list">
              {rows.map((row) => {
                const gift = Array.isArray(row.gift) ? row.gift[0] : row.gift;
                const shareUrl = row.share_id ? `${siteUrl}/g/${row.share_id}` : '';
                const statusClass =
                  row.status === 'refunded'
                    ? 'lb-purchase-row__status--refunded'
                    : 'lb-purchase-row__status--paid';
                return (
                  <li key={row.id} className="lb-purchase-row">
                    <div className="lb-purchase-row__copy">
                      <p className="lb-purchase-row__title">
                        {gift?.title ?? t('unknownGift')}
                      </p>
                      <p className="lb-purchase-row__meta">
                        <span className={statusClass}>
                          {t(`rowStatus.${row.status}` as 'rowStatus.paid')}
                        </span>
                        {' · '}
                        {new Date(row.created_at).toLocaleDateString()}
                      </p>
                      {row.delivery_mode === 'send_to_recipient' && row.recipient_contact ? (
                        <p className="lb-purchase-row__recipient">
                          {t('rowRecipient', { email: row.recipient_contact })}
                        </p>
                      ) : null}
                    </div>
                    {shareUrl ? (
                      <p className="lb-purchase-row__share">
                        <a
                          href={shareUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="lb-btn lb-btn--primary lb-btn--sm"
                        >
                          {t('rowPlayNow')} →
                        </a>
                        <br />
                        <code>{shareUrl}</code>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="lb-auth-foot">
          <Link href="/browse" className="lb-link">
            ← {t('browseMore')}
          </Link>
        </p>
      </section>
    </main>
  );
}
