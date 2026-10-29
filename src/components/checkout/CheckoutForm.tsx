'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  startCheckoutSessionAction,
  startFreeGiftAction,
} from '@/lib/actions/checkout';

/**
 * Checkout form for a single gift (M-E, OOP-4277; free variant OOP-6715).
 *
 * Flow:
 *   1. Buyer picks delivery mode (send_to_recipient vs buyer_shares).
 *   2. If `send_to_recipient`, reveal the email input with a debounce-
 *      free client-side check (basic format only; server re-validates).
 *   3. On submit, call the matching server action.
 *
 * No Stripe.js / Elements — Stripe's hosted Checkout handles the card
 * form. This keeps us out of PCI scope and saves us from hand-rolling
 * a card-input UI.
 *
 * Two variants (OOP-6715):
 *   • `paid` (the default) — `startCheckoutSessionAction` returns a
 *     Stripe Checkout URL and the browser is hard-navigated to it.
 *   • `free` — the gift has `price_cents IS NULL`, so there is no money
 *     to move and no Stripe session to open. `startFreeGiftAction`
 *     mints the share row and the form swaps to the share link, which
 *     is what the paid flow ends up showing after the webhook fires.
 */

type Props = {
  giftId: string;
  /**
   * `paid` opens Stripe Checkout; `free` mints a share and shows the
   * link. Defaults to `paid` so existing call sites are unchanged.
   */
  variant?: 'paid' | 'free';
};

/** What the free flow produced, once it has succeeded. */
type FreeResult = {
  shareUrl: string;
  emailed: boolean;
  recipient: string | null;
};

export function CheckoutForm({ giftId, variant = 'paid' }: Props) {
  const t = useTranslations('Checkout');
  const tErr = useTranslations('Checkout.errors');
  const tFree = useTranslations('Checkout.free');
  const [mode, setMode] = useState<'send_to_recipient' | 'buyer_shares'>(
    'send_to_recipient',
  );
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [freeResult, setFreeResult] = useState<FreeResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const isFree = variant === 'free';

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmed = recipient.trim();
    if (mode === 'send_to_recipient' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(tErr('invalidRecipient'));
      return;
    }

    startTransition(async () => {
      const input = {
        giftId,
        deliveryMode: mode,
        recipientContact: mode === 'send_to_recipient' ? trimmed : undefined,
      };

      if (isFree) {
        const r = await startFreeGiftAction(input);
        if (!r.ok) {
          setError(r.error === 'unauthenticated' ? tErr('signInAgain') : r.error);
          return;
        }
        setFreeResult({
          shareUrl: r.shareUrl,
          emailed: r.emailed,
          recipient: mode === 'send_to_recipient' ? trimmed : null,
        });
        return;
      }

      const r = await startCheckoutSessionAction(input);
      if (!r.ok) {
        setError(r.error === 'unauthenticated' ? tErr('signInAgain') : r.error);
        return;
      }
      // Redirect to Stripe-hosted Checkout. Hard navigation so the
      // server-supplied session id is part of the next round trip.
      window.location.assign(r.url);
    });
  }

  // The free flow has nothing left to ask once the share exists — show
  // the link and get out of the way.
  if (freeResult) {
    return (
      <>
        <div className="lb-checkout-summary">
          <p className="lb-checkout-share-link-label">{tFree('shareLinkLabel')}</p>
          <p className="lb-checkout-share-link">
            <code>{freeResult.shareUrl}</code>
          </p>
          <p className="lb-checkout-share-link-hint">{tFree('shareLinkHint')}</p>
        </div>

        {freeResult.recipient && freeResult.emailed ? (
          <p>{tFree('emailedTo', { email: freeResult.recipient })}</p>
        ) : freeResult.recipient ? (
          // The email did not go out (Resend is not configured in
          // production yet — OOP-6168). Say so loudly: the buyer picked
          // "send it to them", so silence here would leave the
          // recipient with nothing.
          <p className="lb-form__error" role="alert">
            {tFree('emailFailed')}
          </p>
        ) : (
          <p>{tFree('copyToSend')}</p>
        )}
      </>
    );
  }

  return (
    <form className="lb-form" onSubmit={onSubmit} noValidate>
      <fieldset className="lb-field">
        <legend>{t('deliveryModeLabel')}</legend>
        <div className="lb-checkout-delivery-mode">
          <label className={mode === 'send_to_recipient' ? 'is-active' : ''}>
            <input
              type="radio"
              name="deliveryMode"
              value="send_to_recipient"
              checked={mode === 'send_to_recipient'}
              onChange={() => setMode('send_to_recipient')}
            />
            <span>
              <strong>{t('deliverySendToRecipient.title')}</strong>
              <small>
                {isFree
                  ? tFree('deliverySendToRecipientHint')
                  : t('deliverySendToRecipient.hint')}
              </small>
            </span>
          </label>
          <label className={mode === 'buyer_shares' ? 'is-active' : ''}>
            <input
              type="radio"
              name="deliveryMode"
              value="buyer_shares"
              checked={mode === 'buyer_shares'}
              onChange={() => setMode('buyer_shares')}
            />
            <span>
              <strong>{t('deliveryBuyerShares.title')}</strong>
              <small>
                {isFree
                  ? tFree('deliveryBuyerSharesHint')
                  : t('deliveryBuyerShares.hint')}
              </small>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === 'send_to_recipient' ? (
        <label className="lb-field">
          <span>{t('recipientLabel')}</span>
          <input
            type="email"
            name="recipientContact"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={t('recipientPlaceholder')}
            autoComplete="email"
            required
          />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="lb-form__error">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        className="lb-btn lb-btn--primary lb-btn--block"
        disabled={isPending}
      >
        {isPending
          ? isFree
            ? tFree('submitting')
            : t('submitting')
          : isFree
            ? tFree('submit')
            : t('continueToPayment')}
      </button>
    </form>
  );
}
