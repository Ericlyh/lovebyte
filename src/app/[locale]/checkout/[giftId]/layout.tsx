import type { ReactNode } from 'react';
import { ScopedMessages } from '@/lib/i18n/ScopedMessages';
import { routeScopes } from '@/lib/i18n/scopes';

/**
 * OOP-6726 — the message provider for `/checkout/[giftId]`.
 *
 * `NextIntlClientProvider` serialises its messages into the RSC payload,
 * so what this route provides is exactly what this route downloads. The
 * scope list lives in `src/lib/i18n/scopes.ts`; `scopes.test.ts` checks
 * it against what the route actually uses, so a component that starts
 * using a new namespace fails the build rather than rendering a raw key.
 */
type LayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function CheckoutGiftIdLayout({ children, params }: LayoutProps) {
  const { locale } = await params;

  return (
    <ScopedMessages locale={locale} scopes={routeScopes('/checkout/[giftId]')}>
      {children}
    </ScopedMessages>
  );
}
