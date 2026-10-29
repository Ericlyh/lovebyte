'use client';

import PageStateError from '@/components/PageStateError';

/**
 * Typed error boundary for /l/[giftId] (listing detail). Phase 9 (OOP-4225).
 */
export default function ListingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageStateError error={error} reset={reset} icon="🎁" />;
}