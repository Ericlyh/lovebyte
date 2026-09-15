import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Your gifts — LoveByte',
};

/**
 * /purchases — buyer dashboard (M-E, OOP-4277).
 *
 * Lists every purchase the signed-in buyer has made, newest first.
 * For `delivery_mode = 'buyer_shares'` purchases, this is the canonical
 * place to grab the share token. For `send_to_recipient` purchases the
 * buyer may also see the link here (they paid; they can re-share).
 *
 * RLS-permitted via the existing `purchases_select_buyer_own` policy
 * (`0002_marketplace_v2_rls.sql`) — buyer can SELECT their own rows.
 *
 * Reads happen through the user-context server client so RLS applies.
 * Service-role is not used here.
 */
export default async function PurchasesPage() {
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

        {!rows || rows.length === 0 ? (
          <p className="lede">{t('empty')}</p>
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
                      <a href={shareUrl} className="lb-link">
                        {t('rowShareLink')} →
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

        <p className="lb-auth-foot">
          <Link href="/browse" className="lb-link">
            ← {t('browseMore')}
          </Link>
        </p>
      </section>
    </main>
  );
}
