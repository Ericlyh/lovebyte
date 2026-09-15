'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { startCheckoutSessionAction } from '@/lib/actions/checkout';

/**
 * Checkout form for a single gift (M-E, OOP-4277).
 *
 * Flow:
 *   1. Buyer picks delivery mode (send_to_recipient vs buyer_shares).
 *   2. If `send_to_recipient`, reveal the email input with a debounce-
 *      free client-side check (basic format only; server re-validates).
 *   3. On submit, call `startCheckoutSessionAction` which returns a
 *      Stripe Checkout URL. Redirect the browser there.
 *
 * No Stripe.js / Elements — Stripe's hosted Checkout handles the card
 * form. This keeps us out of PCI scope and saves us from hand-rolling
 * a card-input UI.
 */

type Props = {
  giftId: string;
};

export function CheckoutForm({ giftId }: Props) {
  const t = useTranslations('Checkout');
  const tErr = useTranslations('Checkout.errors');
  const [mode, setMode] = useState<'send_to_recipient' | 'buyer_shares'>(
    'send_to_recipient',
  );
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const trimmed = recipient.trim();
    if (mode === 'send_to_recipient' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(tErr('invalidRecipient'));
      return;
    }

    startTransition(async () => {
      const r = await startCheckoutSessionAction({
        giftId,
        deliveryMode: mode,
        recipientContact: mode === 'send_to_recipient' ? trimmed : undefined,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Redirect to Stripe-hosted Checkout. Hard navigation so the
      // server-supplied session id is part of the next round trip.
      window.location.assign(r.url);
    });
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
              <small>{t('deliverySendToRecipient.hint')}</small>
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
              <small>{t('deliveryBuyerShares.hint')}</small>
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
        {isPending ? t('submitting') : t('continueToPayment')}
      </button>
    </form>
  );
}
