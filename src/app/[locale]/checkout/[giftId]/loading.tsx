import { CommonLoading } from '@/components/PageState';

/**
 * Streaming skeleton for /checkout/[giftId] (Stripe Connect redirect).
 * Phase 9 (OOP-4225).
 */
export default function CheckoutLoading() {
  return (
    <main className="lb-checkout-page">
      <CommonLoading />
    </main>
  );
}