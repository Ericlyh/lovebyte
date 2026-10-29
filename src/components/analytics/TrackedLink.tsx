'use client';

import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { trackClientEvent, type ClientEventProps } from '@/lib/analytics/client';
import type { ClientEvent } from '@/lib/analytics/events';

/**
 * TrackedLink — a link that reports a click (OOP-6716).
 *
 * The listing CTA ("Buy this gift") and the landing page's hero buttons
 * live in SERVER components, and a server component cannot attach an
 * onClick handler. This is the client wrapper that does it: the click
 * is reported to `/api/track` and the navigation proceeds exactly as it
 * would on a plain `<Link>` — the report is fire-and-forget and never
 * blocks or cancels the navigation.
 */
export function TrackedLink<E extends ClientEvent>({
  event,
  props,
  children,
  ...linkProps
}: Omit<ComponentProps<typeof Link>, 'onClick'> & {
  event: E;
  props?: ClientEventProps[E];
  children: ReactNode;
}) {
  return (
    <Link
      {...linkProps}
      onClick={() => {
        void trackClientEvent(event, props);
      }}
    >
      {children}
    </Link>
  );
}
