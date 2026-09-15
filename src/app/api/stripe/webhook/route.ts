import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { createServiceRoleClient } from '@/lib/supabase/service-role';
import { sendShareEmail } from '@/lib/email';

/**
 * POST /api/stripe/webhook — Stripe Connect destination-charge receiver
 * (M-E, OOP-4277).
 *
 * Three events handled:
 *   - checkout.session.completed  → INSERT purchases + shares, email recipient.
 *   - account.updated             → UPDATE profiles.stripe_charges_enabled.
 *   - charge.refunded             → UPDATE purchases.status='refunded'.
 *
 * Critical implementation details:
 *   - `runtime = 'nodejs'` so the Stripe SDK works.
 *   - **Raw body via `await request.text()`** — NOT `request.json()`. The
 *     App Router preserves raw bytes for `request.text()` as long as
 *     no body parser has been invoked. `stripe.webhooks.constructEvent`
 *     accepts the text body directly.
 *   - Signature verification happens BEFORE any DB hit. A bad signature
 *     returns 400 with no work done.
 *   - Dedup via `stripe_webhook_events` PK insert. A duplicate `event.id`
 *     returns 200 with `{ dedup: true }` so Stripe stops retrying.
 *   - Service-role writes (`createServiceRoleClient()`) bypass RLS — the
 *     `purchases` table has no user-facing INSERT/UPDATE policies by
 *     design (`0002_marketplace_v2_rls.sql:88-89`).
 *
 * Status codes:
 *   200 { ok: true }                       — processed (incl. dedup)
 *   200 { ok: true, dedup: true }          — duplicate event, no-op
 *   400 { error }                          — missing/invalid signature
 *   500 { error }                          — missing STRIPE_WEBHOOK_SECRET
 *   500 { error }                          — unhandled exception (Stripe retries)
 */

export const runtime = 'nodejs';
// Vercel's default 10s is plenty — webhook work is mostly DB writes
// + one email send. Bump if email send starts long-tail-retrying.
export const maxDuration = 10;

export async function POST(request: Request) {
  const sig = request.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const rawBody = await request.text();

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'webhook secret not configured' },
      { status: 500 },
    );
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (e) {
    console.error('[stripe/webhook] signature verification failed', (e as Error).message);
    return NextResponse.json(
      { error: `signature verification failed: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const service = await createServiceRoleClient();

  // Idempotency. Try to record the event id; PK collision = duplicate.
  // MUST happen before any side effects so a redelivered event is a no-op.
  //
  // Cast through `unknown` → table-row type — the service-role client
  // doesn't have generated DB types yet (see `src/lib/supabase/server.ts`
  // comment "Database generics will be added once `supabase gen types
  // typescript` runs"), so we assert the row shape inline. When the
  // generated types land this cast becomes a no-op.
  const dedupRow = {
    event_id: event.id,
    event_type: event.type,
  };
  const { error: dedupErr } = await (
    service.from('stripe_webhook_events') as unknown as {
      insert: (row: typeof dedupRow) => Promise<{ error: { code?: string; message: string } | null }>;
    }
  ).insert(dedupRow);
  if (dedupErr && dedupErr.code === '23505') {
    return NextResponse.json({ ok: true, dedup: true });
  }
  if (dedupErr) {
    // Log but don't fail — the dispatch handlers below are written to be
    // idempotent on their own (PK on stripe_payment_intent_id, etc.).
    console.error('[stripe/webhook] dedup insert failed', dedupErr.message);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, service);
        break;
      case 'account.updated':
        await handleAccountUpdated(event.data.object as Stripe.Account, service);
        break;
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge, service);
        break;
      default:
        // Unhandled event types: log + 200 so Stripe doesn't retry.
        console.log('[stripe/webhook] unhandled event type', event.type);
    }
  } catch (e) {
    console.error('[stripe/webhook] handler error', event.type, (e as Error).message);
    return NextResponse.json(
      { error: 'handler failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  service: ServiceClient,
) {
  const meta = session.metadata ?? {};
  const giftId = meta.gift_id;
  const buyerId = meta.buyer_id;
  const deliveryMode = meta.delivery_mode;
  const recipientContact = (meta.recipient_contact ?? '').trim() || null;
  const piId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
  const amount = session.amount_total ?? 0;
  const currency = (session.currency ?? 'hkd').toUpperCase();

  if (!giftId || !buyerId || !piId) {
    console.error('[stripe/webhook] checkout.session.completed missing metadata', session.id);
    return;
  }
  if (deliveryMode !== 'send_to_recipient' && deliveryMode !== 'buyer_shares') {
    console.error('[stripe/webhook] checkout.session.completed invalid delivery_mode', deliveryMode);
    return;
  }
  if (deliveryMode === 'send_to_recipient' && !recipientContact) {
    console.error('[stripe/webhook] send_to_recipient without recipient_contact', session.id);
    return;
  }

  // application_fee_amount lives on the PaymentIntent, not the Session
  // in this API version. Retrieve to get the authoritative numbers; if
  // the retrieve fails (rare — webhook normally arrives after PI is
  // created), fall back to computing from the gift's fee_bps so the
  // purchase row still has a sensible value.
  let fee = 0;
  try {
    const pi = await stripe.paymentIntents.retrieve(piId);
    fee = pi.application_fee_amount ?? 0;
  } catch (e) {
    console.error('[stripe/webhook] paymentIntents.retrieve failed', (e as Error).message);
    try {
      const { data: giftRow } = await (service.from('gifts') as unknown as {
        select: (cols: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: { platform_fee_bps?: number } | null }> } };
      })
        .select('platform_fee_bps')
        .eq('id', giftId)
        .maybeSingle();
      const bps = giftRow?.platform_fee_bps ?? 1000;
      fee = Math.floor((amount * bps) / 10000);
    } catch {
      fee = Math.floor((amount * 1000) / 10000); // default 10%
    }
  }
  const creatorPayout = Math.max(0, amount - fee);

  // Mint the share token first so the purchase row can FK to it.
  // `shares.token` is the PK; format is 32 hex chars matching the
  // server-side `mintShareToken()` shape that lived in checkout.ts.
  const shareToken = randomBytes(16).toString('hex');

  // All service-role writes go through typed-shaped inserts below to
  // satisfy `tsc` until `supabase gen types typescript` runs.
  const sharesInsert = {
    token: shareToken,
    gift_id: giftId,
    created_by: buyerId,
  };
  const { error: shareErr } = await (service.from('shares') as unknown as {
    insert: (row: typeof sharesInsert) => Promise<{ error: { code?: string; message: string } | null }>;
  }).insert(sharesInsert);
  if (shareErr && shareErr.code !== '23505') {
    // Not fatal — purchases.share_id is nullable. Log + continue.
    console.error('[stripe/webhook] shares insert failed', shareErr.message);
  }

  const purchaseInsert = {
    buyer_id: buyerId,
    gift_id: giftId,
    amount_cents: amount,
    platform_fee_cents: fee,
    creator_payout_cents: creatorPayout,
    currency,
    stripe_payment_intent_id: piId,
    stripe_session_id: session.id,
    status: 'paid',
    delivery_mode: deliveryMode,
    recipient_contact: recipientContact,
    share_id: shareToken,
  };
  const { error: purchaseErr } = await (service.from('purchases') as unknown as {
    insert: (row: typeof purchaseInsert) => Promise<{ error: { code?: string; message: string } | null }>;
  }).insert(purchaseInsert);
  if (purchaseErr && purchaseErr.code !== '23505') {
    // 23505 = PK/UNIQUE collision on stripe_payment_intent_id; safe to ignore.
    console.error('[stripe/webhook] purchases insert failed', purchaseErr.message);
    return;
  }

  // Recipient flow: email the share link. Buyer-share path leaves the
  // buyer to grab the link from /purchases.
  if (deliveryMode === 'send_to_recipient' && recipientContact) {
    const { data: giftRow } = await (service.from('gifts') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { title?: string } | null }>;
        };
      };
    })
      .select('title')
      .eq('id', giftId)
      .maybeSingle();
    const { data: buyerRow } = await (service.from('profiles') as unknown as {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          maybeSingle: () => Promise<{ data: { display_name?: string | null; handle?: string | null } | null }>;
        };
      };
    })
      .select('display_name, handle')
      .eq('id', buyerId)
      .maybeSingle();

    const buyerName =
      (buyerRow?.display_name as string | null) ??
      (buyerRow?.handle ? `@${buyerRow.handle}` : null);

    const emailRes = await sendShareEmail({
      to: recipientContact,
      giftTitle: giftRow?.title ?? 'A gift for you',
      shareToken,
      buyerName,
    });
    if (!emailRes.ok) {
      console.error('[stripe/webhook] sendShareEmail failed', emailRes.error);
    }
  }
}

async function handleAccountUpdated(acct: Stripe.Account, service: ServiceClient) {
  if (!acct.id) return;
  const update = { stripe_charges_enabled: !!acct.charges_enabled };
  const { error } = await (service.from('profiles') as unknown as {
    update: (row: typeof update) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  })
    .update(update)
    .eq('stripe_account_id', acct.id);
  if (error) {
    console.error('[stripe/webhook] account.updated update failed', error.message);
  }
}

async function handleChargeRefunded(charge: Stripe.Charge, service: ServiceClient) {
  if (typeof charge.payment_intent !== 'string') return;
  const update = {
    status: 'refunded',
    refunded_at: new Date().toISOString(),
  };
  const { error } = await (service.from('purchases') as unknown as {
    update: (row: typeof update) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  })
    .update(update)
    .eq('stripe_payment_intent_id', charge.payment_intent);
  if (error) {
    console.error('[stripe/webhook] charge.refunded update failed', error.message);
  }
}
