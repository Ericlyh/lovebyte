import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Nav } from '@/components/Nav';

/**
 * /checkout/cancel — Stripe `cancel_url` landing (M-E, OOP-4277).
 *
 * One-screen server component. The buyer hit Cancel on Stripe-hosted
 * Checkout; no payment has happened, so there's nothing to query.
 * Surface a single CTA back to /browse so they can pick a different
 * gift.
 */

export const metadata = {
  title: 'Checkout cancelled — LoveByte',
};

export default async function CheckoutCancelPage() {
  const t = await getTranslations('Checkout.cancel');

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />
      <section className="lb-onboarding-card">
        <h1>{t('title')}</h1>
        <p className="lede">{t('lede')}</p>
        <p className="lb-auth-foot">
          <Link href="/browse" className="lb-link">
            ← {t('browseCta')}
          </Link>
        </p>
      </section>
    </main>
  );
}
