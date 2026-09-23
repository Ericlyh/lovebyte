import { CommonLoading } from '@/components/PageState';

/**
 * Streaming skeleton for /purchases. Phase 9 (OOP-4225).
 */
export default function PurchasesLoading() {
  return (
    <main className="lb-purchases-page">
      <CommonLoading />
    </main>
  );
}