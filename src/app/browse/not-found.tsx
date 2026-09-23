import { CommonNotFound } from '@/components/PageState';

/**
 * Typed 404 for /browse — only fires if the route itself is missing
 * (the empty-feed state is handled by /browse/page.tsx).
 * Phase 9 (OOP-4225).
 */
export default function BrowseNotFound() {
  return (
    <main className="lb-browse-page">
      <CommonNotFound />
    </main>
  );
}