import type { ReactNode } from 'react';
import { ScopedMessages } from '@/lib/i18n/ScopedMessages';
import { routeScopes } from '@/lib/i18n/scopes';

/**
 * OOP-6727 — the message provider for `/gifts/[slug]`.
 *
 * This route has its own provider rather than sharing the `/gifts` one:
 * nested providers do NOT merge (the nearest one wins), so a route's
 * provider has to carry every scope its own tree needs. See
 * `src/lib/i18n/scopes.ts`.
 */
type LayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function GiftGuideLayout({ children, params }: LayoutProps) {
  const { locale } = await params;

  return (
    <ScopedMessages locale={locale} scopes={routeScopes('/gifts/[slug]')}>
      {children}
    </ScopedMessages>
  );
}
