import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Nav } from '@/components/Nav';
import { CheckoutForm } from '@/components/checkout/CheckoutForm';
import { PriceBadge } from '@/components/catalog/PriceBadge';
import { CommonLoading } from '@/components/PageState';
import { createClient } from '@/lib/supabase/server';
import { getCheckoutGift, type CheckoutGift } from '@/lib/checkout/gift';
import { BRAND } from '@/lib/brand';

/**
 * /checkout/[giftId] — pre-payment buyer flow (M-E, OOP-4277).
 *
 * Server component that:
 *   1. Loads the listed gift — a gift that is not there is a 404.
 *   2. Auth-gates (anon buyers go to /login).
 *   3. Renders a summary.
 *   4. Renders `<CheckoutForm>` (client component) for delivery-mode +
 *      recipient input.
 *
 * The action (`startCheckoutSessionAction`) calls Stripe and returns a
 * hosted Checkout URL; the form does a hard `window.location.assign()`
 * to it. From there, Stripe handles payment and bounces the buyer to
 * /checkout/success or /checkout/cancel.
 *
 * ## Why there is no `loading.tsx` here (OOP-6729)
 *
 * The segment used to carry a `loading.tsx`. That file is a
 * `<Suspense>` boundary AROUND this page, and a Suspense boundary
 * lets Next.js flush the response shell (the loading skeleton, HTTP
 * 200) before this page's `notFound()` ever runs — so every guessed
 * gift id served a real page with a 200. The guard has to run BEFORE
 * anything is flushed, so the check happens at the top of the page and
 * throws `notFound()`. The skeleton is kept; it moved INSIDE the page
 * (the `<Suspense>` below), where it covers the payout-state read.
 */
type Props = {
  params: Promise<{ locale: string; giftId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { giftId } = await params;
  // OOP-6729 — a checkout for a gift that does not exist is a 404, and
  // the metadata must not describe a page that does not exist.
  const gift = await getCheckoutGift(giftId);
  if (!gift) notFound();
  return {
    title: `Checkout — ${BRAND.NAME}`,
    description: `Buy a gift on ${BRAND.NAME} (${giftId.slice(0, 8)}…).`,
  };
}

/**
 * The streaming skeleton, kept from the old `loading.tsx` (OOP-6729).
 * It now renders as the `<Suspense>` fallback inside the page instead
 * of as a segment-level loading boundary.
 */
function CheckoutSkeleton() {
  return (
    <main className="lb-checkout-page">
      <CommonLoading />
    </main>
  );
}

export default async function CheckoutPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { giftId } = await params;

  // OOP-6729 — the existence check runs BEFORE the auth gate. A
  // checkout for a gift that does not exist is a 404, and it has to be
  // a 404 for an anonymous visitor too: otherwise every guessed gift
  // id answers with a redirect to /login and the not-found URL space is
  // endless.
  const gift = await getCheckoutGift(giftId);
  if (!gift) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/checkout/${giftId}`);
  }

  const owner = gift.owner;
  const creatorLabel =
    owner?.display_name ?? (owner?.handle ? `@${owner.handle}` : 'a creator');

  // A free listing has no money to move, so it never opens a Stripe
  // session — and it must not be gated on the creator's Stripe
  // readiness either, because no payout is involved (OOP-6715).
  // `gifts_price_cents_chk` constrains `price_cents` to NULL or a
  // positive integer, so a listed gift is either free or paid.
  const isFree = gift.price_cents == null || gift.price_cents <= 0;

  return (
    <Suspense fallback={<CheckoutSkeleton />}>
      <CheckoutView gift={gift} creatorLabel={creatorLabel} isFree={isFree} />
    </Suspense>
  );
}

/**
 * The part of the checkout that is slow: the creator's payout state.
 * Split out of the page so it can sit behind a `<Suspense>` and the
 * visitor sees the skeleton while it is read.
 */
async function CheckoutView({
  gift,
  creatorLabel,
  isFree,
}: {
  gift: CheckoutGift;
  creatorLabel: string;
  isFree: boolean;
}) {
  const t = await getTranslations('Checkout');

  // The payout state lives on `profiles` (migration 0006), and that
  // migration has NOT been applied to the production project. PostgREST
  // rejects the WHOLE request when a selected column does not exist, so
  // asking for `stripe_charges_enabled` alongside the gift made this
  // page 404 for every listing — free and paid alike.
  //
  // A free listing moves no money and needs no payout state, so the
  // read happens only for a paid listing. `unknown` means we could not
  // determine the state at all (the column is missing), which is a
  // different problem from "this creator cannot take payouts yet" and
  // gets its own message.
  let payoutState: 'ready' | 'not-ready' | 'unknown' = 'not-ready';
  if (!isFree) {
    const supabase = await createClient();
    const { data: profile, error: payoutErr } = await supabase
      .from('profiles')
      .select('stripe_account_id, stripe_charges_enabled')
      .eq('id', gift.owner_id)
      .maybeSingle();
    if (payoutErr) {
      console.error('[checkout] payout state read failed', payoutErr.message);
      payoutState = 'unknown';
    } else {
      payoutState = profile?.stripe_charges_enabled ? 'ready' : 'not-ready';
    }
  }

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
        ) : payoutState === 'ready' ? (
          <CheckoutForm giftId={gift.id} />
        ) : (
          <div className="lb-form__error" role="alert">
            <p>
              {payoutState === 'unknown'
                ? t('payoutStateUnknown')
                : t('creatorNotReady')}
            </p>
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
