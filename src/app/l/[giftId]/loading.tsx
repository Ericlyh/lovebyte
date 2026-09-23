import { CommonLoading } from '@/components/PageState';

/**
 * Streaming skeleton for /l/[giftId]. Phase 9 (OOP-4225).
 */
export default function ListingLoading() {
  return (
    <main className="lb-listing-page">
      <CommonLoading />
    </main>
  );
}