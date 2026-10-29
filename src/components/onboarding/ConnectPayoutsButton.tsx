'use client';

import { useTransition, useState } from 'react';
import { useTranslations } from 'next-intl';
import { startConnectOnboardingAction } from '@/lib/actions/checkout';

/**
 * "Connect payouts" button for /onboarding (M-E, OOP-4277).
 *
 * Wraps `startConnectOnboardingAction` in a `useTransition` + a single
 * error-state slot. On success, redirect the browser to the Stripe-
 * hosted onboarding URL.
 *
 * Stripe's `account.updated` webhook flips
 * `profiles.stripe_charges_enabled` once the creator finishes identity
 * verification. The /onboarding page re-reads that flag on next visit
 * so the button text reflects the new state.
 *
 * `returnPath` (OOP-6720): where Stripe sends the creator once they are
 * done. It defaults to this page. But a creator who arrived here because
 * their onboarding link EXPIRED — they were mid-publish — must land back
 * on the publish page, or the listing they were publishing is lost. The
 * /onboarding page passes the gift id through for that case.
 */

export function ConnectPayoutsButton({ returnPath }: { returnPath?: string }) {
  const t = useTranslations('Onboarding.connect');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const r = await startConnectOnboardingAction({ returnPath });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      window.location.assign(r.url);
    });
  }

  return (
    <div className="lb-connect-payouts">
      <button
        type="button"
        onClick={onClick}
        className="lb-btn lb-btn--primary lb-btn--block"
        disabled={isPending}
      >
        {isPending ? t('ctaConnecting') : t('ctaConnect')}
      </button>
      {error ? (
        <p role="alert" className="lb-form__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
