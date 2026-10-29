import 'server-only';
import { parseEventProps, type AnalyticsEvent } from './events';
import { resolveSessionId } from './session';
import { isSessionId } from './session-id';
import { recordEvent } from './store';

/**
 * The server-side recorder (OOP-6716).
 *
 * One entry point for every event the SERVER records — a Stripe
 * session created, a webhook received, a row inserted, a gift opened.
 * It validates the props against the event's schema (so an unknown key
 * can never reach storage, even from a server-side caller), resolves
 * the session id, writes the event, and logs one line.
 *
 * It never throws. An analytics write failing must not fail a purchase
 * or a page render; the failure is logged and the caller carries on.
 */
export async function trackEvent(
  event: AnalyticsEvent,
  props?: Record<string, unknown>,
  opts?: { sessionId?: string; date?: string },
): Promise<boolean> {
  const parsed = parseEventProps(event, props);
  if (!parsed.ok) {
    console.error(`[analytics] ${event} rejected props: ${parsed.error}`);
    return false;
  }

  // An explicitly supplied session id is used only if it is well
  // formed — it becomes part of a storage object name, so a malformed
  // one is not trusted. The webhook's Stripe metadata is the usual
  // source; a session minted here is the fallback.
  const sessionId =
    opts?.sessionId && isSessionId(opts.sessionId)
      ? opts.sessionId
      : await resolveSessionId();

  const result = await recordEvent({
    event,
    sessionId,
    props: parsed.props,
    date: opts?.date,
  });

  if (!result.ok) {
    console.error(`[analytics] ${event} write failed: ${result.error}`);
    return false;
  }

  // OOP-6739 — a trace, not a fault, so it goes to `console.info`.
  // The props are safe to print: `parseEventProps` strips every key
  // the event's schema does not name, so no email address or share
  // token can reach this line (see the PII rule in ./events.ts).
  console.info(`[analytics] ${event}`, { sessionId, props: parsed.props });
  return true;
}

/**
 * True when the request is a PREFETCH rather than a real navigation.
 *
 * This matters because the gift-open route counts an open — it
 * increments `shares.view_count` — and a prefetch is not an open. Next
 * marks its own segment-cache prefetches with the `Next-Router-Prefetch`
 * header and honours the browser's `purpose: prefetch`; both are
 * checked here, along with the `Sec-Purpose` / `X-Purpose` variants
 * other browsers send.
 *
 * Without this, a crawler or a `<Link>` in the viewport would inflate
 * the open count and the funnel.
 */
export function isPrefetchRequest(requestHeaders: Headers): boolean {
  if (requestHeaders.get('next-router-prefetch')) return true;
  if (requestHeaders.get('x-middleware-prefetch')) return true;

  const purpose = requestHeaders.get('purpose') ?? '';
  if (purpose.includes('prefetch')) return true;

  const secPurpose = requestHeaders.get('sec-purpose') ?? '';
  if (secPurpose.includes('prefetch')) return true;

  const xPurpose = requestHeaders.get('x-purpose') ?? '';
  if (xPurpose.includes('prefetch')) return true;

  return false;
}
