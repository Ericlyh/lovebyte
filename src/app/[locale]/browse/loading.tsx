import { CommonLoading } from '@/components/PageState';

/**
 * Streaming skeleton for /browse — PostgREST catalog feed is the
 * slowest route on the public surface. Phase 9 (OOP-4225).
 */
export default function BrowseLoading() {
  return (
    <main className="lb-browse-page">
      <CommonLoading />
    </main>
  );
}