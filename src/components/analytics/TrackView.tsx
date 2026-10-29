'use client';

import { useEffect } from 'react';
import { trackClientEvent, type ClientEventProps } from '@/lib/analytics/client';
import type { ClientEvent } from '@/lib/analytics/events';

/**
 * TrackView — report a page view (OOP-6716).
 *
 * Renders nothing. On mount it reports one event, which is what a page
 * view IS.
 *
 * It is a client component on purpose. The landing page and /browse are
 * prerendered once per locale (OOP-6710); a server-side hook would
 * fire once per build/ISR window instead of once per visitor, and
 * reading the session cookie or the forwarded header server-side would
 * opt the route out of prerendering entirely. A client effect fires
 * once per real visit — which is what "9 people looked at the homepage"
 * has to mean for the number to be worth anything.
 */
export function TrackView<E extends ClientEvent>({
  event,
  props,
}: {
  event: E;
  props?: ClientEventProps[E];
}) {
  // The props are an object literal, so its identity changes on every
  // render. Serialising it gives a stable dependency that changes only
  // when the values change.
  const propsKey = props ? JSON.stringify(props) : '';

  useEffect(() => {
    void trackClientEvent(event, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, propsKey]);

  return null;
}
