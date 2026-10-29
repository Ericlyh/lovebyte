import { CommonNotFound } from '@/components/PageState';

/**
 * OOP-6727 — the 404 for an unknown gift guide.
 *
 * `dynamicParams` is off, so a slug that is not in the registry is
 * rejected before the page runs. Without this boundary the visitor
 * would get Next's bare default 404 page instead of the site's.
 */
export default function GiftGuideNotFound() {
  return (
    <main className="lb-content-page" aria-labelledby="lb-404-title">
      <CommonNotFound />
    </main>
  );
}
