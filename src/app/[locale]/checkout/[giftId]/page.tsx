import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { PriceBadge } from '@/components/catalog/PriceBadge';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';

/**
 * /checkout/[giftId] — pre-payment buyer flow (M-E, OOP-4277).
 *
 * Server component that:
 *   1. Auth-gates (anon buyers go to /login).
 *   2. Loads the listed gift and renders a summary.
 *   3. Renders `<CheckoutForm>` (client component) for delivery-mode +
 *      recipient input.
 *
 * The action (`startCheckoutSessionAction`) calls Stripe and returns a
 * hosted Checkout URL; the form does a hard `window.location.assign()`
 * to it. From there, Stripe handles payment and bounces the buyer to
 * /checkout/success or /checkout/cancel.
 */

type Props = {
  params: Promise<{ locale: string; giftId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { giftId } = await params;
  return {
    title: `Checkout — ${BRAND.NAME}`,
    description: `Buy a gift on ${BRAND.NAME} (${giftId.slice(0, 8)}…).`,
  };
}

export default async function CheckoutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { giftId } = await params;
  const t = await getTranslations('Checkout');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/checkout/${giftId}`);
  }

  const { data: gift, error } = await supabase
    .from('gifts')
    .select(
      'id, title, description, price_cents, currency, owner_id, owner:profiles!owner_id(handle, display_name, stripe_charges_enabled)',
    )
    .eq('id', giftId)
    .eq('is_listed', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !gift) notFound();

  const owner = Array.isArray(gift.owner) ? gift.owner[0] : gift.owner;
  const creatorLabel =
    owner?.display_name ?? (owner?.handle ? `@${owner.handle}` : 'a creator');
  const creatorReady = !!owner?.stripe_charges_enabled;

  // A free listing has no money to move, so it never opens a Stripe
  // session — and it must not be gated on the creator's Stripe
  // readiness either, because no payout is involved (OOP-6715).
  // `gifts_price_cents_chk` constrains `price_cents` to NULL or a
  // positive integer, so a listed gift is either free or paid.
  const isFree = gift.price_cents == null || gift.price_cents <= 0;

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <section className="lb-onboarding-card">
        <h1>{t('title')}</h1>
        <p className="lede">
          {isFree
            ? t('free.ledePrefix', { creator: creatorLabel })
            : t('ledePrefix', { creator: creatorLabel })}
        </p>

        <article className="lb-checkout-summary">
          <h2>{gift.title}</h2>
          {gift.description ? <p>{gift.description}</p> : null}
          <PriceBadge priceCents={gift.price_cents} />
        </article>

        {isFree ? (
          <CheckoutForm giftId={gift.id} variant="free" />
        ) : creatorReady ? (
          <CheckoutForm giftId={gift.id} />
        ) : (
          <div className="lb-form__error" role="alert">
            <p>{t('creatorNotReady')}</p>
            <p>
              <Link href={`/l/${gift.id}`} className="lb-link">
                ← {t('backToListing')}
              </Link>
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
