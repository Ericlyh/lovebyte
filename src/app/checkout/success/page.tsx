import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { BRAND } from '@/lib/brand';

/**
 * /checkout/success — post-payment landing (M-E, OOP-4277).
 *
 * Stripe's `success_url` template appends `?session_id={CHECKOUT_SESSION_ID}`.
 * We use that session_id to look up the purchase via service-role
 * (the buyer's session may not have re-hydrated yet after the Stripe
 * redirect).
 *
 * Why service-role instead of createClient()? Two reasons:
 *   1. The RLS policy on `purchases` is service-role-write only;
 *      SELECT-by-stripe_session_id is permitted for anon/authed via the
 *      existing grants — but the lookup is cheaper service-side because
 *      we already have the user id from the session metadata cached
 *      in `purchases.buyer_id` and `stripe_payment_intent_id`.
 *   2. Timing: Stripe fires the webhook BEFORE it redirects the buyer.
 *      By the time the success page loads the row should exist, but
 *      there's a race — we tolerate the row being missing by showing a
 *      "processing" state rather than erroring.
 */

export const metadata: Metadata = {
  title: `Thank you — ${BRAND.NAME}`,
};

type Props = {
  searchParams: Promise<{ session_id?: string }>;
};

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const params = await searchParams;
  if (!params.session_id) redirect('/');
  const t = await getTranslations('Checkout.success');

  let purchase: {
    gift_id: string;
    share_id: string | null;
    delivery_mode: string;
    recipient_contact: string | null;
    amount_cents: number;
    currency: string;
  } | null = null;

  try {
    const service = await createServiceRoleClient();
    const { data } = await (service.from('purchases') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: typeof purchase }>;
        };
      };
    })
      .select('gift_id, share_id, delivery_mode, recipient_contact, amount_cents, currency')
      .eq('stripe_session_id', params.session_id)
      .maybeSingle();
    purchase = data ?? null;
  } catch (e) {
    console.error('[checkout/success] purchase lookup failed', (e as Error).message);
  }

  // Race-tolerant: if the webhook hasn't fired yet, tell the buyer to
  // refresh rather than 500. Stripe fires the webhook synchronously
  // before the redirect, but a slow DB write can still race.
  if (!purchase || !purchase.share_id) {
    return (
      <main className="min-h-screen flex flex-col">
        <Nav />
        <section className="lb-onboarding-card">
          <h1>{t('processingTitle')}</h1>
          <p className="lede">{t('processingBody')}</p>
        </section>
      </main>
    );
  }

  const shareUrl = `${(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/g/${purchase.share_id}`;

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />
      <section className="lb-onboarding-card">
        <h1>{t('title')}</h1>
        <p className="lede">
          {purchase.delivery_mode === 'send_to_recipient'
            ? t('ledeRecipient', { email: purchase.recipient_contact ?? '' })
            : t('ledeSelf')}
        </p>

        <article className="lb-checkout-summary">
          <p className="lb-checkout-share-link-label">{t('shareLinkLabel')}</p>
          <p className="lb-checkout-share-link">
            <code>{shareUrl}</code>
          </p>
          <p className="lb-checkout-share-link-hint">{t('shareLinkHint')}</p>
        </article>

        <p className="lb-auth-foot">
          <Link href="/purchases" className="lb-link">
            {t('viewAllCta')} →
          </Link>
        </p>
      </section>
    </main>
  );
}

// Hint to TS that createClient is still a usable import here — keeps
// the unused-import linter quiet in case the file is later extended
// to do user-context reads.
void createClient;
