'use client';

import PageStateError from '@/components/PageStateError';

/**
 * Typed error boundary for /purchases. Phase 9 (OOP-4225).
 */
export default function PurchasesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageStateError error={error} reset={reset} icon="🧾" />;
}