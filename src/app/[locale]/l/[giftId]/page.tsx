import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { LikeButton } from '@/components/catalog/LikeButton';
import { ListingComments } from '@/components/catalog/ListingComments';
import { ListingPreview } from '@/components/catalog/ListingPreview';
import { ListingReplies } from '@/components/catalog/ListingReplies';
import { PriceBadge } from '@/components/catalog/PriceBadge';
import { CommonLoading } from '@/components/PageState';
import { TrackView } from '@/components/analytics/TrackView';
import { TrackedLink } from '@/components/analytics/TrackedLink';
import { createClient } from '@/lib/supabase/server';
import {
  getListingDetail,
  getListingComments,
  getListingReplies,
  type CatalogListing,
} from '@/lib/catalog';
import { BRAND } from '@/lib/brand';
import { JsonLd } from '@/components/seo/JsonLd';
import { listingUrl, productJsonLd } from '@/lib/seo/jsonld';
import { listingOgImage } from '@/lib/seo/metadata';

/**
 * /l/[giftId] — listing detail (M-C, OOP-4275).
 *
 * Server component. RLS-permitted anon read; the 404 path covers
 * "doesn't exist", "not listed", and "soft-deleted". The auth-aware
 * like button hydrates client-side to decide between the three render
 * modes (loading / anon / authed).
 *
 * Self-liking: not blocked at the server level — a creator can like
 * their own listing (gifting yourself a heart is fine, and it makes the
 * UI feel less broken in preview). M-D can revisit it if needed.
 *
 * ## Why there is no `loading.tsx` here (OOP-6729)
 *
 * This route used to carry a segment-level `loading.tsx`. That file is
 * not a cosmetic choice — it is a `<Suspense>` boundary AROUND this
 * page, and a Suspense boundary lets Next.js flush the response shell
 * (the loading skeleton, HTTP 200) BEFORE this page's `notFound()`
 * ever runs. The 404 was therefore rendered *inside* an
 * already-committed 200 response: a "Gift not found" page that
 * crawlers read as a real, indexable page — an infinite URL space of
 * soft-404s, on URLs that are gift UUIDs.
 *
 * The fix is the order of operations: the existence check has to
 * happen BEFORE anything is flushed, so it happens here, at the top of
 * the page, and it throws `notFound()`. The streaming skeleton is kept
 * — it just moved INSIDE the page (the `<Suspense>` below), so it
 * still covers the comment/reply reads while the listing itself is
 * already known to exist.
 *
 * The same pattern is used by /u/[handle], which has always returned
 * a real 404.
 */
type Props = {
  params: Promise<{ locale: string; giftId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { giftId } = await params;
  const listing = await getListingDetail(giftId);
  // OOP-6729 — a listing that does not exist is a 404, not a page
  // with a sad title. `notFound()` in generateMetadata keeps the
  // metadata from describing a page that does not exist (and stops a
  // "Gift not found — Lovorithm" title from being served with a 200).
  if (!listing) notFound();
  const creatorLabel = listing.owner.display_name ?? `@${listing.owner.handle}`;
  const title = `${listing.title} by ${creatorLabel} — ${BRAND.NAME}`;
  const description =
    listing.description ?? `${listing.title} on ${BRAND.NAME}.`;
  // OOP-6728 — the listing's canonical URL is the same URL the
  // structured data and the sitemap use, so the three agree on which
  // URL a gift lives at.
  const canonical = listingUrl(giftId);
  // OOP-6727 — the social card is the listing's OWN card, generated at
  // /api/og/listing/<id>: a 1200x630 image carrying the title, the
  // creator, the format and the price. The cover PHOTO stays in the
  // list as the second image — the structured data points at it, and
  // platforms that render more than one image still get to see the
  // product itself — but the card goes first, because a raw photo in
  // the primary slot is cropped to an unpredictable shape by every feed
  // that renders it.
  const card = listingOgImage(listing.id);
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      siteName: BRAND.NAME,
      title,
      description,
      url: canonical,
      images: [
        { url: card, width: 1200, height: 630, alt: listing.title },
        ...(listing.cover_url
          ? [{ url: listing.cover_url, alt: listing.title }]
          : []),
      ],
    },
    // Next REPLACES a parent's `twitter` wholesale when a child defines
    // one, and the root layout's Twitter card is the site-wide brand
    // card. Left alone, a listing unfurled on X / Twitter with the
    // generic card under the listing's title.
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [card],
    },
  };
}

/**
 * The streaming skeleton, kept from the old `loading.tsx` (OOP-6729).
 * It now renders as the `<Suspense>` fallback inside the page instead
 * of as a segment-level loading boundary.
 */
function ListingSkeleton() {
  return (
    <main className="lb-listing-page">
      <CommonLoading />
    </main>
  );
}

export default async function ListingPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { giftId } = await params;
  // Memoised (React `cache()`), so the `generateMetadata` pass and this
  // pass share ONE read of the listing (OOP-6722). It used to be read
  // twice, each read being three queries.
  const listing = await getListingDetail(giftId);
  // OOP-6729 — the guard that makes this route return a real 404. It
  // has to run BEFORE the response is flushed, which is why the
  // segment no longer has a `loading.tsx` boundary (see the note
  // above).
  if (!listing) notFound();

  return (
    <Suspense fallback={<ListingSkeleton />}>
      <ListingView listing={listing} />
    </Suspense>
  );
}

/**
 * Everything that is not the existence check. Split out of the page so
 * it can sit behind a `<Suspense>`: the comment and reply reads are
 * slow, and the visitor should see the listing while they land.
 */
async function ListingView({ listing }: { listing: CatalogListing }) {
  const t = await getTranslations('Catalog.listing');
  const creatorLabel = listing.owner.display_name ?? `@${listing.owner.handle}`;

  // Three reads that do not depend on each other, issued together
  // (OOP-6722). The page used to walk them one at a time.
  //
  //  • First page of comments (SSR'd so anon visitors see real comments
  //    on first paint). The client component takes over from there with
  //    pagination, optimistic inserts, and soft-delete. We use the same
  //    helper as `/api/gift-comments/[giftId]` so the SSR + CSR shape
  //    matches byte-for-byte.
  //  • First page of threaded replies (M-G, OOP-4890). Same pattern as
  //    comments above. We pre-fetch so anon visitors see real threads on
  //    first paint; the client component handles pagination + optimistic
  //    inserts + per-author / per-creator delete.
  //  • The viewer's identity. Owner-only copy hinges on it — anon
  //    visitors shouldn't see "List a gift" as a CTA.
  const supabase = await createClient();
  const [firstPage, firstRepliesPage, { data: { user } }] = await Promise.all([
    getListingComments(listing.id, null),
    getListingReplies(listing.id, null),
    supabase.auth.getUser(),
  ]);

  // Pre-fetch the viewer's like state if authed. Used to render the
  // LikeButton with the right initial paint (no client roundtrip).
  let initialLiked = false;
  if (user) {
    const { data } = await supabase
      .from('gift_likes')
      .select('profile_id')
      .eq('profile_id', user.id)
      .eq('gift_id', listing.id)
      .maybeSingle();
    initialLiked = !!data;
  }

  return (
    <main className="min-h-screen flex flex-col">
      {/* OOP-6728 — the listing IS the product, so it says so in
          structured data: the title, the cover, the creator and the
          price. A free gift emits no `offers` block at all — see the
          free-listing rule in `src/lib/seo/jsonld.ts`. */}
      <JsonLd
        node={productJsonLd({
          id: listing.id,
          title: listing.title,
          description: listing.description,
          category: listing.category,
          priceCents: listing.price_cents,
          coverUrl: listing.cover_url,
          creator: {
            handle: listing.owner.handle,
            displayName: listing.owner.display_name,
          },
        })}
      />

      <Nav />

      {/* OOP-6716 — the listing step of the funnel, and the step the
          purchase is attributed to. Reported from the browser: this
          page is rendered per request, but a `<Link>` prefetch is a
          request too, and a prefetched listing is not a view. */}
      <TrackView
        event="listing_view"
        props={{ gift_type: listing.type, gift_id: listing.id }}
      />

      <article className="lb-listing">
        <header className="lb-listing-hero">
          <p className="lb-listing-hero__category">
            {t(`category.${listing.category ?? 'unknown'}`)}
          </p>
          <h1 className="lb-listing-hero__title">{listing.title}</h1>
          <p className="lb-listing-hero__creator">
            {t('by')}{' '}
            <Link href={`/u/${listing.owner.handle}`} className="lb-link">
              {creatorLabel}
            </Link>
          </p>

          <div className="lb-listing-hero__meta">
            <PriceBadge priceCents={listing.price_cents} />
            <LikeButton
              giftId={listing.id}
              initialLiked={initialLiked}
              initialLikeCount={listing.like_count}
            />
          </div>

          {listing.description ? (
            <p className="lb-listing-hero__description">{listing.description}</p>
          ) : null}
        </header>

        <ListingPreview
          title={listing.title}
          description={listing.description}
          category={listing.category}
        />

        <ListingComments
          giftId={listing.id}
          initialComments={firstPage.comments}
          initialTotalCount={firstPage.totalCount}
          initialHasMore={firstPage.nextCursor != null}
          initialNextCursor={firstPage.nextCursor}
        />

        <ListingReplies
          giftId={listing.id}
          giftOwnerId={listing.owner.id}
          initialReplies={firstRepliesPage.replies}
          initialTotalCount={firstRepliesPage.totalCount}
          initialHasMore={firstRepliesPage.nextCursor != null}
          initialNextCursor={firstRepliesPage.nextCursor}
        />

        <footer className="lb-listing-cta">
          <TrackedLink
            event="listing_cta_click"
            props={{ gift_type: listing.type, gift_id: listing.id }}
            href={`/checkout/${listing.id}`}
            className="lb-btn lb-btn--primary lb-cta-primary"
          >
            {t('sendThisGift')}
          </TrackedLink>
        </footer>
      </article>
    </main>
  );
}
