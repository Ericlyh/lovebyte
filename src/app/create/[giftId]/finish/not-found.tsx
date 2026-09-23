import { CommonNotFound } from '@/components/PageState';

/**
 * Typed 404 for /create/[giftId]/finish — draft deleted or never
 * existed. Phase 9 (OOP-4225).
 */
export default function FinishNotFound() {
  return (
    <main className="lb-finish-page">
      <CommonNotFound />
    </main>
  );
}