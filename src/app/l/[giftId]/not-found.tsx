import { CommonNotFound } from '@/components/PageState';

/**
 * Typed 404 for /l/[giftId] — listing unpublished or never existed.
 * Phase 9 (OOP-4225).
 */
export default function ListingNotFound() {
  return (
    <main className="lb-listing-page">
      <CommonNotFound />
    </main>
  );
}