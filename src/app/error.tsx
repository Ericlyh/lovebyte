'use client';

import PageStateError from '@/components/PageStateError';

/**
 * Typed error boundary for the landing page. Phase 9 (OOP-4225).
 */
export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageStateError error={error} reset={reset} icon="🏠" />;
}