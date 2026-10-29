import { CommonNotFound } from '@/components/PageState';

/**
 * Typed 404 for /checkout/[giftId]. Phase 9 (OOP-4225).
 */
export default function CheckoutNotFound() {
  return (
    <main className="lb-checkout-page">
      <CommonNotFound />
    </main>
  );
}