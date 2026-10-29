'use client';

import { useState, useTransition, useCallback, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { publishToMarketplaceAction } from '@/lib/actions/publish';
import { BRAND } from '@/lib/brand';
import {
  PLATFORM_FEE_BPS_DEFAULT,
  PLATFORM_FEE_BPS_MIN,
  SETTLEMENT_CURRENCY_SYMBOL,
} from '@/lib/money';
import { isOptimizableMediaUrl } from '@/lib/media';

export type GiftMediaItem = {
  id: string;
  /** Pre-resolved public URL for the media item. */
  url: string;
};

type Props = {
  /** The draft gift's UUID (from the gifts table). */
  giftId: string;
  /** Default title pre-filled from the draft. */
  defaultTitle: string;
  /**
   * Default description, read from the gift row. Set when the creator
   * came back from Stripe — their listing intent was persisted before
   * they left, and this puts it back in the form (OOP-6720).
   */
  defaultDescription?: string | null;
  /** Default price in cents, read from the gift row (OOP-6720). */
  defaultPriceCents?: number | null;
  /** Default cover media id, read from the gift row (OOP-6720). */
  defaultCoverMediaId?: string | null;
  /** Existing gift_media rows for this gift (for cover picker). */
  mediaItems: GiftMediaItem[];
  /** Platform fee in basis points (default 1000 = 10%). */
  platformFeeBps?: number;
  /**
   * True when the creator came back from Stripe onboarding
   * (`?stripe=return`). The card then re-runs the publish on mount with
   * `publishAfterStripe: true` — that is the step that completes the
   * paid listing (OOP-6720).
   */
  stripeReturn?: boolean;
  /** Called when the user clicks "Save as draft" (existing builder behaviour). */
  onSaveDraft?: () => void;
};

/**
 * PublishToMarketplaceCard (M-F, OOP-4278).
 *
 * Renders after the builder's "Save as draft" button. Shows:
 *   - Title input (pre-filled with draft title)
 *   - Description textarea (max 500 chars, with live counter)
 *   - Cover media picker (thumbnail grid from gift_media rows)
 *   - Price toggle (free / paid)
 *   - Price input (shown when paid), in the settlement currency
 *   - Platform fee display
 *   - Publish button → calls publishToMarketplaceAction
 *
 * OOP-6714: there is no currency selector. The marketplace settles in one
 * currency (HKD), so a creator prices in HK$ and the platform does the
 * rest — a per-listing currency is what let the catalogue end up with
 * three of them behind dollar-denominated filters.
 *
 * The paid round trip (OOP-6720):
 *
 *   publish(price > 0)  → server saves the listing intent on the gift row
 *                         and answers needsStripe; we leave for Stripe.
 *   Stripe returns us to /create/<id>/finish?stripe=return — the server
 *   persisted our title/price/currency, so this page reads them back off
 *   the row and hands them to this card.
 *   `stripeReturn` → the card re-runs the publish with
 *   publishAfterStripe: true, and the listing goes live.
 *
 * Before this, nothing read `?stripe=return` and the return URL pointed
 * at a page that could not complete the publish, so every paid creator
 * ended up with a lost listing.
 */
export function PublishToMarketplaceCard({
  giftId,
  defaultTitle,
  defaultDescription,
  defaultPriceCents,
  defaultCoverMediaId,
  mediaItems,
  platformFeeBps = PLATFORM_FEE_BPS_DEFAULT,
  stripeReturn = false,
  onSaveDraft,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state. The defaults come from the gift row so a creator
  // returning from Stripe sees exactly what they typed before they left.
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription ?? '');
  const [coverMediaId, setCoverMediaId] = useState<string | null>(
    defaultCoverMediaId ?? null,
  );
  // A persisted price of 0 means "free", so it must not select the Paid
  // toggle — that would leave the form in a state it cannot publish from.
  const [isFree, setIsFree] = useState(
    defaultPriceCents == null || defaultPriceCents <= 0,
  );
  const [priceCents, setPriceCents] = useState(
    defaultPriceCents != null && defaultPriceCents > 0
      ? (defaultPriceCents / 100).toFixed(2)
      : '',
  );
  const [error, setError] = useState<string | null>(null);

  // Derived
  const descriptionLength = description.length;
  const descriptionOver = descriptionLength > 500;
  const feePercent = (platformFeeBps / 100).toFixed(1);
  const effectivePriceCents = isFree ? null : Math.round(parseFloat(priceCents || '0') * 100);

  const publish = useCallback(
    async (opts: { afterStripe: boolean }) => {
      const result = await publishToMarketplaceAction({
        giftId,
        title,
        description: description || null,
        coverMediaId,
        priceCents: isFree ? null : effectivePriceCents,
        platformFeeBps,
        publishAfterStripe: opts.afterStripe,
      });

      if (result.ok) {
        router.push(`/l/${result.giftId}`);
        return;
      }
      if (result.needsStripe) {
        // Leave for Stripe onboarding. The server has already saved the
        // listing intent on the gift row and pointed Stripe's return URL
        // back at this page with `?stripe=return`, so the publish
        // completes on the way back (OOP-6720).
        window.location.href = result.onboardingUrl;
        return;
      }
      setError(result.error);
    },
    [
      giftId,
      title,
      description,
      coverMediaId,
      isFree,
      effectivePriceCents,
      platformFeeBps,
      router,
    ],
  );

  const handlePublish = useCallback(() => {
    setError(null);
    startTransition(async () => {
      // `stripeReturn` means the creator has already been through
      // onboarding, so every attempt from here on must NOT send them
      // through it again — that was the loop (OOP-6720).
      await publish({ afterStripe: stripeReturn });
    });
  }, [publish, stripeReturn]);

  // Complete the paid round trip. The creator comes back from Stripe
  // with `?stripe=return`; re-running the publish here is what actually
  // puts the listing up. The ref guard keeps it to one call per mount
  // (React re-runs effects in StrictMode).
  const autoPublishStarted = useRef(false);
  useEffect(() => {
    if (!stripeReturn || autoPublishStarted.current) return;
    autoPublishStarted.current = true;
    setError(null);
    startTransition(async () => {
      await publish({ afterStripe: true });
    });
  }, [stripeReturn, publish]);

  const canPublish =
    title.trim().length > 0 &&
    !descriptionOver &&
    (isFree || (priceCents.length > 0 && effectivePriceCents != null && effectivePriceCents > 0));

  return (
    <div className="lb-publish-card">
      <h2 className="lb-publish-card__title">Publish to marketplace</h2>
      <p className="lb-publish-card__lede">
        Set your listing details and go live on {BRAND.NAME}.
      </p>

      {/* The creator is back from Stripe. The publish re-runs itself; this
          line explains why the form is busy before they touch anything
          (OOP-6720). */}
      {stripeReturn && (
        <p className="lb-field-hint" role="status">
          {isPending
            ? 'Finishing your publish…'
            : 'Your Stripe setup is done. Your listing details were saved — publish again if you need to.'}
        </p>
      )}

      {/* Title */}
      <div className="lb-field">
        <span>Title</span>
        <input
          type="text"
          className="lb-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Give your gift a name"
        />
        <small>{title.length}/100</small>
      </div>

      {/* Description */}
      <div className="lb-field">
        <span>Description</span>
        <textarea
          className="lb-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder="What makes this gift special? (optional)"
        />
        <small
          className={`lb-field__countdown${descriptionOver ? ' lb-field__countdown--warn' : ''}`}
        >
          {descriptionLength}/500
        </small>
      </div>

      {/* Cover media picker */}
      {mediaItems.length > 0 && (
        <div className="lb-field">
          <span>Cover photo</span>
          <div className="lb-publish-cover-grid">
            {mediaItems.map((media) => (
              <button
                key={media.id}
                type="button"
                className={`lb-publish-cover-thumb${
                  coverMediaId === media.id ? ' lb-publish-cover-thumb--selected' : ''
                }`}
                onClick={() => setCoverMediaId(coverMediaId === media.id ? null : media.id)}
                aria-label={`Select cover`}
              >
                <Image
                  src={media.url}
                  alt=""
                  className="lb-publish-cover-thumb__img"
                  width={72}
                  height={72}
                  unoptimized={!isOptimizableMediaUrl(media.url)}
                />
              </button>
            ))}
          </div>
          <small>Tap to select a cover photo (optional)</small>
        </div>
      )}

      {/* Price toggle */}
      <div className="lb-field">
        <span>Price</span>
        <div className="lb-publish-price-toggle">
          <button
            type="button"
            className={`lb-pill${isFree ? ' lb-pill--active' : ''}`}
            onClick={() => setIsFree(true)}
          >
            Free
          </button>
          <button
            type="button"
            className={`lb-pill${!isFree ? ' lb-pill--active' : ''}`}
            onClick={() => setIsFree(false)}
          >
            Paid
          </button>
        </div>
      </div>

      {/* Price input (shown when paid). The amount is in the settlement
          currency — HK$ — and there is no currency picker (OOP-6714). */}
      {!isFree && (
        <div className="lb-publish-price-row">
          <div className="lb-field" style={{ flex: 1 }}>
            <span>Amount ({SETTLEMENT_CURRENCY_SYMBOL})</span>
            <input
              type="number"
              className="lb-input"
              value={priceCents}
              onChange={(e) => setPriceCents(e.target.value)}
              min="0.01"
              step="0.01"
              placeholder="0.00"
            />
          </div>
        </div>
      )}

      {/* Platform fee display */}
      <div className="lb-publish-fee-note">
        <span>Platform fee: </span>
        <strong>{feePercent}%</strong>
        {platformFeeBps < PLATFORM_FEE_BPS_DEFAULT && (
          <span> (minimum {PLATFORM_FEE_BPS_MIN / 100}%)</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="lb-form__error" role="alert">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="lb-publish-card__actions">
        {onSaveDraft && (
          <button
            type="button"
            className="lb-btn lb-btn--ghost"
            onClick={onSaveDraft}
            disabled={isPending}
          >
            Save as draft
          </button>
        )}
        <button
          type="button"
          className="lb-btn lb-btn--primary"
          onClick={handlePublish}
          disabled={!canPublish || isPending}
        >
          {isPending ? 'Publishing…' : 'Publish to marketplace'}
        </button>
      </div>
    </div>
  );
}
