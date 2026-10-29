import { NextResponse } from 'next/server';
import { isClientEvent, parseEventProps } from '@/lib/analytics/events';
import { existingSessionId } from '@/lib/analytics/session';
import { recordEvent } from '@/lib/analytics/store';

/**
 * POST /api/track — the browser's event sink (OOP-6716).
 *
 * The browser may report only the seven CLIENT_EVENTS (a page view, a
 * click, a filter, a search). Anything that depends on a server-side
 * outcome — a Stripe session created, a payment completed, a row
 * inserted — is recorded server-side and is NOT accepted here, so a
 * crafted POST cannot fake a purchase.
 *
 * The session id is NEVER taken from the request body. It is derived
 * from the httpOnly `lb-sid` cookie that the proxy set, so a client
 * cannot attribute events to somebody else's session, and cannot file
 * events outside a session it actually has. A request with no session
 * cookie is refused: the proxy mints sessions for page visits, so a
 * missing cookie means the caller never came through a page, and an
 * analytics sink that invents its own sessions is a sink anyone can
 * spam.
 *
 * Props are validated against the event's schema before anything is
 * written — and Zod strips unknown keys, so the schema is the whole
 * allowlist. A request carrying `email` or a share token loses those
 * fields before the write.
 *
 * Status codes:
 *   202 { ok: true }                  — event recorded
 *   400 { ok: false, error }          — bad body / unknown event / no session
 *   413 { ok: false, error }          — body too large
 *   500 { ok: false, error }          — storage write failed
 */
export const runtime = 'nodejs';

/** A props payload is a handful of short fields; anything bigger is abuse. */
const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Body too large.' },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { event, props } = (body ?? {}) as { event?: unknown; props?: unknown };
  if (typeof event !== 'string' || !isClientEvent(event)) {
    return NextResponse.json(
      { ok: false, error: 'Unknown event.' },
      { status: 400 },
    );
  }

  const parsed = parseEventProps(event, props);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const sessionId = await existingSessionId();
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: 'No session.' },
      { status: 400 },
    );
  }

  const result = await recordEvent({ event, sessionId, props: parsed.props });
  if (!result.ok) {
    console.error('[analytics/track] write failed', result.error);
    return NextResponse.json(
      { ok: false, error: 'Could not record that event.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 202 });
}
