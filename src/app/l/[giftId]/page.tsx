import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { LikeButton } from '@/components/catalog/LikeButton';
import { ListingComments } from '@/components/catalog/ListingComments';
import { ListingPreview } from '@/components/catalog/ListingPreview';
import { PriceBadge } from '@/components/catalog/PriceBadge';
import { createClient } from '@/lib/supabase/server';
import { getListingDetail, getListingComments } from '@/lib/catalog';

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
 * UI feel less broken in preview). M-D can revisit this if needed.
 */
type Props = {
  params: Promise<{ giftId: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { giftId } = await params;
  const listing = await getListingDetail(giftId);
  if (!listing) {
    return { title: 'Gift not found — LoveByte' };
  }
  const creatorLabel = listing.owner.display_name ?? `@${listing.owner.handle}`;
  return {
    title: `${listing.title} by ${creatorLabel} — LoveByte`,
    description: listing.description ?? `${listing.title} on LoveByte.`,
  };
}

export default async function ListingPage({ params }: Props) {
  const { giftId } = await params;
  const listing = await getListingDetail(giftId);
  if (!listing) notFound();

  const t = await getTranslations('Catalog.listing');
  const creatorLabel = listing.owner.display_name ?? `@${listing.owner.handle}`;

  // Pre-fetch the viewer's like state if authed. Used to render the
  // LikeButton with the right initial paint (no client roundtrip).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  // First page of comments (SSR'd so anon visitors see real comments on
  // first paint). The client component takes over from there with
  // pagination, optimistic inserts, and soft-delete. We use the same
  // helper as `/api/gift-comments/[giftId]` so the SSR + CSR shape
  // matches byte-for-byte.
  const firstPage = await getListingComments(listing.id, null);

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <article className="lb-container lb-listing">
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
            <PriceBadge priceCents={listing.price_cents} currency={listing.currency} />
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

        <footer className="lb-listing-cta">
          <Link href={`/checkout/${listing.id}`} className="lb-btn lb-btn--primary lb-cta-primary">
            {t('sendThisGift')}
          </Link>
        </footer>
      </article>
    </main>
  );
}
