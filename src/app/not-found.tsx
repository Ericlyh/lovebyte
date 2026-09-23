import { CommonNotFound } from '@/components/PageState';

/**
 * Typed 404 for the landing page. Phase 9 (OOP-4225).
 */
export default function HomeNotFound() {
  return (
    <main className="lb-landing-page" aria-labelledby="lb-404-title">
      <CommonNotFound />
    </main>
  );
}