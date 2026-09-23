'use client';

import PageStateError from '@/components/PageStateError';

/**
 * Typed error boundary for /u/me (own profile). Phase 9 (OOP-4225).
 */
export default function MeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageStateError error={error} reset={reset} icon="🪞" />;
}