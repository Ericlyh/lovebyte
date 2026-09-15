'use client';

import { useState, useTransition, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { publishToMarketplaceAction } from '@/lib/actions/publish';

const LOVEBYTE_MIN_FEE_BPS = 500;
const LOVEBYTE_DEFAULT_FEE_BPS = 1000;

const CURRENCIES = [
  { value: 'usd', label: 'USD ($)' },
  { value: 'hkd', label: 'HKD (HK$)' },
  { value: 'gbp', label: 'GBP (£)' },
  { value: 'eur', label: 'EUR (€)' },
  { value: 'jpy', label: 'JPY (¥)' },
  { value: 'cad', label: 'CAD (C$)' },
  { value: 'aud', label: 'AUD (A$)' },
] as const;

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
  /** Existing gift_media rows for this gift (for cover picker). */
  mediaItems: GiftMediaItem[];
  /** Platform fee in basis points (default 1000 = 10%). */
  platformFeeBps?: number;
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
 *   - Price input + currency selector (shown when paid)
 *   - Platform fee display
 *   - Publish button → calls publishToMarketplaceAction
 *
 * Stripe gating: if price > 0 and the creator has no stripe_charges_enabled,
 * the server returns needsStripe=true and we redirect to the onboarding URL.
 * After onboarding completes, the caller should re-call with publishAfterStripe.
 */
export function PublishToMarketplaceCard({
  giftId,
  defaultTitle,
  mediaItems,
  platformFeeBps = LOVEBYTE_DEFAULT_FEE_BPS,
  onSaveDraft,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [coverMediaId, setCoverMediaId] = useState<string | null>(null);
  const [isFree, setIsFree] = useState(true);
  const [priceCents, setPriceCents] = useState('');
  const [currency, setCurrency] = useState<string>('usd');
  const [error, setError] = useState<string | null>(null);

  // Derived
  const descriptionLength = description.length;
  const descriptionOver = descriptionLength > 500;
  const feePercent = (platformFeeBps / 100).toFixed(1);
  const effectivePriceCents = isFree ? null : Math.round(parseFloat(priceCents || '0') * 100);

  const handlePublish = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await publishToMarketplaceAction({
        giftId,
        title,
        description: description || null,
        coverMediaId,
        priceCents: isFree ? null : effectivePriceCents,
        currency,
        platformFeeBps,
      });

      if (result.ok) {
        router.push(`/l/${result.giftId}`);
      } else if (result.needsStripe) {
        // Redirect to Stripe onboarding. On return, the parent should
        // detect the stripe=return query param and re-call publish.
        window.location.href = result.onboardingUrl;
      } else {
        setError(result.error);
      }
    });
  }, [giftId, title, description, coverMediaId, isFree, effectivePriceCents, currency, platformFeeBps, router]);

  const canPublish =
    title.trim().length > 0 &&
    !descriptionOver &&
    (isFree || (priceCents.length > 0 && effectivePriceCents != null && effectivePriceCents > 0));

  return (
    <div className="lb-publish-card">
      <h2 className="lb-publish-card__title">Publish to marketplace</h2>
      <p className="lb-publish-card__lede">
        Set your listing details and go live on LoveByte.
      </p>

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
          maxLength={600}
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
                <img
                  src={media.url}
                  alt=""
                  className="lb-publish-cover-thumb__img"
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

      {/* Price input (shown when paid) */}
      {!isFree && (
        <div className="lb-publish-price-row">
          <div className="lb-field" style={{ flex: 1 }}>
            <span>Amount</span>
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
          <div className="lb-field" style={{ width: 140 }}>
            <span>Currency</span>
            <select
              className="lb-select"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Platform fee display */}
      <div className="lb-publish-fee-note">
        <span>Platform fee: </span>
        <strong>{feePercent}%</strong>
        {platformFeeBps < LOVEBYTE_DEFAULT_FEE_BPS && (
          <span> (minimum {LOVEBYTE_MIN_FEE_BPS / 100}%)</span>
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
