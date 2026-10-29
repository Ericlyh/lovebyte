import type { ClientEvent, EventProps } from './events';

/**
 * The browser-side reporter (OOP-6716).
 *
 * The browser reports only what it can observe: a page was viewed, a
 * button was pressed, a filter was changed, a search was typed. It
 * POSTs to `/api/track`, which validates the event against the
 * allowlist and derives the session id from the httpOnly cookie — the
 * browser never sees or sends a session id itself.
 *
 * Why page views are recorded HERE and not in the server component:
 * the landing page and /browse are prerendered once per locale
 * (OOP-6710), so a server-side hook would fire once per build/ISR
 * window instead of once per visitor — and a `headers()` read to
 * resolve the session would opt the route out of prerendering
 * entirely. A client effect fires once per real visit, which is what
 * "9 people looked at the homepage" means.
 */

/** Props accepted per client event. */
export type ClientEventProps = {
  [E in ClientEvent]?: EventProps<E>;
};

/**
 * Report an event. Fire-and-forget: it never throws and never blocks
 * the interaction that triggered it.
 *
 * `keepalive` lets the request outlive a page unload — a click that
 * navigates away would otherwise cancel the POST before the server saw
 * it.
 */
export async function trackClientEvent<E extends ClientEvent>(
  event: E,
  props?: ClientEventProps[E],
): Promise<void> {
  try {
    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, props: props ?? {} }),
      keepalive: true,
    });
  } catch {
    // Analytics is never worth surfacing an error for.
  }
}
