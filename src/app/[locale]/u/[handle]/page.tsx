import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';
import { Nav } from '@/components/Nav';
import { FollowButton } from '@/components/profile/FollowButton';
import { EmptyCollectionState } from '@/components/profile/EmptyCollectionState';
import { EmptyMyGifts } from '@/components/profile/EmptyMyGifts';
import { CreatorSalesCard } from '@/components/profile/CreatorSalesCard';
import { OwnedGiftActions } from '@/components/profile/OwnedGiftActions';
import { GiftCard } from '@/components/catalog/GiftCard';
import {
  getProfileByHandle,
  getRedirectForOldHandle,
} from '@/lib/profiles/query';
import { HANDLE_REGEX, HANDLE_MAX_LENGTH } from '@/lib/profiles/handle';
import { getFollowerCount, getFollowers } from '@/lib/profiles/followers';
import { getCatalogFeed } from '@/lib/catalog';
import { getOwnedGifts } from '@/lib/profiles/ownedGifts';
import { getCreatorSales } from '@/lib/profiles/sales';
import { createClient } from '@/lib/supabase/server';
import { BRAND } from '@/lib/brand';

/**
 * /u/[handle] — public creator profile (OOP-4274 M-B; M-D extends
 * with follower count + Followers tab; OOP-5685 splits the single
 * "Collection" into two: "For Sale" (public) + "My Gifts" (owner only)).
 *
 * Edge-runtime safe: data fetch goes through `profiles_public`
 * (anon-readable view from M-A). The authed follow action is wired
 * via the FollowButton client component (OOP-4285) and updates the
 * follower's local state; the page revalidates with `router.refresh()`
 * so the SSR-rendered follower count stays in sync after a toggle.
 *
 * **Two-collection layout (OOP-5685):**
 *   • `#for-sale` — gifts the creator has listed on the marketplace.
 *     Public via `gifts_select_public_listed` RLS. Always rendered.
 *   • `#mine`    — gifts the creator owns, including drafts + unlisted.
 *     Owner-only via `gifts_select_own` RLS; non-owners get an empty
 *     array (we gate the section on `viewerIsOwner` so non-owners never
 *     see the header either).
 *
 * The "About" tab is a static placeholder; the "Followers" tab shows
 * the real follower list from `creator_follows` (OOP-6719 — it used to
 * render a fixed "No followers yet." whatever the count was).
 *
 * **Owner-only sections (OOP-6719):**
 *   • `#mine`  — the creator's whole gift library, plus the unpublish
 *     button on every listed gift.
 *   • `#sales` — gross sales, net earnings and units sold, read through
 *     the `purchases_select_buyer_or_seller` RLS policy that already
 *     existed but that nothing in the app read.
 *
 * **Handle-change redirect (OOP-4284 Part C):** if the requested
 * handle doesn't exist in `profiles_public`, we look up
 * `handle_history.old_handle` and 301-redirect to the new handle so
 * stale links keep working after a rename.
 *
 * The handle param is validated here as a 404 guard before we touch
 * the DB. The DB-side CHECK constraint is the source of truth; this
 * guard just keeps us from echoing malformed handles back to the URL.
 */
type Props = {
  params: Promise<{ locale: string; handle: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const profile = await getProfileByHandle(handle);
  const name = profile?.display_name ?? `@${handle}`;
  return {
    title: `${name} — ${BRAND.NAME}`,
    description: profile?.bio ?? `Creator profile @${handle} on ${BRAND.NAME}.`,
  };
}

export default async function CreatorProfilePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { handle } = await params;

  // Reject malformed handles with a 404 rather than 500. Mirrors the
  // DB CHECK constraint — if the handle passes this regex it would
  // round-trip the profiles_public view safely.
  if (
    !handle ||
    handle.length < 3 ||
    handle.length > HANDLE_MAX_LENGTH ||
    !HANDLE_REGEX.test(handle)
  ) {
    notFound();
  }

  const profile = await getProfileByHandle(handle);
  if (!profile) {
    // Handle changed at some point. Look up the history and 301 to
    // the new handle. If no history row exists, it's a real 404.
    const redirectTarget = await getRedirectForOldHandle(handle);
    if (redirectTarget) {
      redirect(`/u/${redirectTarget.newHandle}`);
    }
    notFound();
  }

  const t = await getTranslations('Profile');
  const displayName = profile.display_name ?? `@${profile.handle}`;
  const links = Array.isArray(profile.links)
    ? (profile.links as unknown[]).filter(
        (l): l is string => typeof l === 'string' && /^https?:\/\//.test(l),
      )
    : [];

  // Three reads that do not depend on each other, issued together
  // (OOP-6722). They used to run one after another, and the page's
  // 2.8s TTFB was mostly this serialisation.
  //
  //  • Follower count (M-D) — a cheap `head: true` + `count: 'exact'`
  //    query against `creator_follows`; the RLS policy
  //    `creator_follows_select_public` lets anon read it.
  //  • Viewer auth (OOP-4225 Phase 9 polish). Owner-only copy on the
  //    empty-state card hinges on this — anon visitors shouldn't see
  //    "List a gift" as a CTA. Anon-readable via the JWT-less server
  //    client; `auth.getUser()` returns null without error.
  //  • The creator's listed gifts (OOP-4225 Phase 9 polish). Reuses the
  //    same RLS-permitted feed query as /browse so the visual language
  //    of the cards stays consistent across the app. Capped at
  //    PAGE_SIZE (20) for the first paint.
  const supabase = await createClient();
  const [followerCount, user, { gifts: creatorListings }] = await Promise.all([
    getFollowerCount(profile.id),
    supabase.auth.getUser().then(({ data }) => data.user),
    getCatalogFeed({
      creator: profile.handle,
      sort: 'published_desc',
    }),
  ]);

  const viewerIsOwner = !!user && user.id === profile.id;

  // The owner-only reads and the follower list — also independent of
  // each other, so they go out together (OOP-6722).
  //
  //  • Owner's full gift library (OOP-5685). Drafts + unlisted + listed.
  //    Returns [] for non-owners (RLS `gifts_select_own`); we only
  //    render the section when `viewerIsOwner` so the empty-array branch
  //    is purely defensive — keeping the call here means the server does
  //    the single RLS check whether or not the visitor is authed.
  //  • The creator's sales figures (OOP-6719). The RLS on `purchases`
  //    (`purchases_select_buyer_or_seller`) already lets a seller read
  //    their own sales rows; this is the first thing in the app that
  //    does. Owner-only, and only fetched for the owner — the section is
  //    not part of a visitor's page at all.
  //  • Who actually follows this creator (OOP-6719). The Followers tab
  //    used to render a fixed "No followers yet." whatever the count was.
  //    `creator_follows` is public-readable, so this is safe for anyone.
  //    Skipped entirely when the count is zero — the common case, and
  //    the list would be empty anyway.
  const [ownedGifts, sales, followers] = await Promise.all([
    viewerIsOwner ? getOwnedGifts(profile.handle) : [],
    viewerIsOwner ? getCreatorSales(profile.id) : null,
    followerCount > 0 ? getFollowers(profile.id) : [],
  ]);

  return (
    <main className="min-h-screen flex flex-col">
      <Nav />

      <section className="lb-profile-hero">
        <h1>{displayName}</h1>
        <p className="lb-profile-handle">@{profile.handle}</p>
        {profile.bio ? <p className="lb-profile-bio">{profile.bio}</p> : null}
        {links.length > 0 ? (
          <ul className="lb-profile-links">
            {links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="lb-profile-hero__actions">
          <FollowButton
            creatorId={profile.id}
            handle={profile.handle}
            initialFollowerCount={followerCount}
          />
          <span
            className="lb-profile-followers-badge"
            aria-label={t('followersCount', {
              count: followerCount,
            })}
          >
            {t('followersLabel', { count: followerCount })}
          </span>
        </div>
      </section>

      <section className="lb-profile-tabs" aria-label={t('tabsAria')}>
        <a href="#for-sale" className="lb-tab lb-tab--active">
          {t('forSale')}
        </a>
        {viewerIsOwner ? (
          <a href="#mine" className="lb-tab">
            {t('myGifts')}
          </a>
        ) : null}
        {viewerIsOwner ? (
          <a href="#sales" className="lb-tab">
            {t('salesTab')}
          </a>
        ) : null}
        <a href="#about" className="lb-tab">
          {t('about')}
        </a>
        <a href="#followers" className="lb-tab">
          {t('followersTab', { count: followerCount })}
        </a>
      </section>

      <section
        id="for-sale"
        className="lb-profile-collection lb-profile-section"
        aria-labelledby="lb-profile-for-sale-title"
      >
        <h2 id="lb-profile-for-sale-title" className="lb-profile-section__title">
          {t('forSale')}
        </h2>
        {creatorListings.length > 0 ? (
          <div className="lb-profile-collection-grid">
            {creatorListings.map((gift) => (
              <GiftCard key={gift.id} gift={gift} />
            ))}
          </div>
        ) : (
          <EmptyCollectionState
            viewerIsOwner={viewerIsOwner}
            handle={profile.handle}
          />
        )}
      </section>

      {viewerIsOwner ? (
        <section
          id="mine"
          className="lb-profile-collection lb-profile-section lb-profile-section--private"
          aria-labelledby="lb-profile-mine-title"
        >
          <div className="lb-profile-section__head">
            <h2
              id="lb-profile-mine-title"
              className="lb-profile-section__title"
            >
              {t('myGifts')}
            </h2>
            <span className="lb-profile-section__private-badge">
              <span aria-hidden="true">🔒</span>
              <span>{t('privateNote')}</span>
            </span>
          </div>
          {ownedGifts.length > 0 ? (
            <div className="lb-profile-collection-grid">
              {ownedGifts.map((gift) => (
                <div key={gift.id} className="lb-owned-gift">
                  {/* A draft or an unpublished listing has no public
                      detail page, so the card is a plain tile rather
                      than a link to a 404. */}
                  <GiftCard
                    gift={gift}
                    href={gift.is_listed && !gift.is_unpublished ? `/l/${gift.id}` : null}
                  />
                  <OwnedGiftActions
                    giftId={gift.id}
                    mode={
                      gift.is_unpublished
                        ? 'republish'
                        : gift.is_listed
                          ? 'unpublish'
                          : null
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyMyGifts />
          )}
        </section>
      ) : null}

      {viewerIsOwner && sales ? (
        <section
          id="sales"
          className="lb-profile-collection lb-profile-section lb-profile-section--private"
          aria-labelledby="lb-profile-sales-title"
        >
          <div className="lb-profile-section__head">
            <h2 id="lb-profile-sales-title" className="lb-profile-section__title">
              {t('sales.title')}
            </h2>
            <span className="lb-profile-section__private-badge">
              <span aria-hidden="true">🔒</span>
              <span>{t('privateNote')}</span>
            </span>
          </div>
          <CreatorSalesCard summary={sales.summary} />
        </section>
      ) : null}

      <section
        id="about"
        className="lb-profile-collection lb-profile-section"
        aria-labelledby="lb-profile-about-title"
      >
        <h2 id="lb-profile-about-title" className="lb-profile-section__title">
          {t('about')}
        </h2>
        {profile.bio ? (
          <p className="lb-profile-section__about-body">{profile.bio}</p>
        ) : (
          <p className="lb-profile-section__about-body lb-profile-section__about-body--muted">
            {t('emptyAbout', { handle: profile.handle })}
          </p>
        )}
        {links.length > 0 ? (
          <ul className="lb-profile-section__about-links">
            {links.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section
        id="followers"
        className="lb-profile-collection lb-profile-section"
        aria-labelledby="lb-profile-followers-title"
      >
        <h2
          id="lb-profile-followers-title"
          className="lb-profile-section__title"
        >
          {t('followersTab', { count: followerCount })}
        </h2>
        {followers.length > 0 ? (
          <>
            <p className="lb-profile-section__about-body">
              {t('followersSummary', { count: followerCount })}
            </p>
            <ul className="lb-followers-list">
              {followers.map((follower) => (
                <li key={follower.id} className="lb-followers-list__item">
                  <Link
                    href={`/u/${follower.handle}`}
                    className="lb-followers-list__link"
                  >
                    {follower.displayName ?? `@${follower.handle}`}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="lb-profile-section__about-body lb-profile-section__about-body--muted">
            {t('followersEmpty')}
          </p>
        )}
      </section>
    </main>
  );
}
