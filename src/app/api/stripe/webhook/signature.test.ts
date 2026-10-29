import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signature verification on the Stripe webhook (OOP-6736).
 *
 * The webhook route is the only place in the app that decides whether a
 * Stripe event is real. It has never run against a real Stripe event —
 * the keys are missing in production until OOP-6168 lands — and the
 * existing route test MOCKED `constructEvent` away, so the signature
 * check itself was never executed by any test. A webhook that accepts
 * an unsigned request is a webhook anyone on the internet can use to
 * mint purchases.
 *
 * So this file uses the REAL Stripe SDK. `stripe.webhooks` is borrowed
 * from a real client, which means the signature math here is the same
 * math Stripe does — `generateTestHeaderString` signs a payload
 * locally and `constructEvent` verifies it, with no network call and
 * no Stripe account. The key is a dummy; the only thing a real key
 * would unlock is the API, and nothing here calls the API.
 *
 * What is pinned:
 *
 *   - a payload signed with the webhook secret is ACCEPTED, and the
 *     purchase it describes is written
 *   - a body edited after it was signed is REJECTED (400, no writes)
 *   - a signature that does not match the body is REJECTED
 *   - a payload signed with the WRONG secret is REJECTED
 *   - a request with no signature header at all is REJECTED
 *
 * Every rejection also asserts that NOTHING was written: the route
 * verifies the signature before it touches the database, so a forged
 * request must not leave a purchase row, a share, an email or an
 * analytics event behind.
 */

const { WEBHOOK_SECRET } = vi.hoisted(() => {
  // The Stripe client is built lazily from STRIPE_SECRET_KEY, and the
  // mock factory below borrows the signature helpers from a real
  // client — so the env has to exist BEFORE the modules are imported.
  // `vi.hoisted` is the only hook that runs that early.
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  return { WEBHOOK_SECRET: 'whsec_test_secret' };
});

const state = vi.hoisted(() => ({
  /** Every row written through the service-role client. */
  inserted: [] as { table: string; row: Record<string, unknown> }[],
  /** Every recipient email sent. */
  emails: [] as { to: string }[],
  /** Every analytics event recorded. */
  events: [] as { event: string }[],
}));

vi.mock('@/lib/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stripe')>();
  // A REAL Stripe client: `constructEvent` and
  // `generateTestHeaderString` below are the SDK's own code, doing the
  // SDK's own signature math.
  const sdk = actual.getStripe();
  return {
    ...actual,
    stripe: {
      webhooks: sdk.webhooks,
      // The one outbound call the purchase handler makes. Stubbed so
      // the test never touches the network.
      paymentIntents: {
        retrieve: async () => ({ application_fee_amount: 180 }),
      },
    },
  };
});

vi.mock('@/lib/supabase/service-role', () => {
  const selectData = (table: string): Record<string, unknown> | null => {
    if (table === 'gifts') {
      return { title: 'Trivia of our first year', platform_fee_bps: 1000 };
    }
    if (table === 'profiles') return { display_name: 'Ada Lovelace', handle: 'ada' };
    return null;
  };
  const fakeFrom = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.eq = () => builder;
    builder.is = () => builder;
    builder.maybeSingle = async () => ({ data: selectData(table), error: null });
    return {
      select: () => builder,
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        return { error: null };
      },
      update: async (row: Record<string, unknown>) => {
        state.inserted.push({ table, row });
        return { error: null };
      },
    };
  };
  return { createServiceRoleClient: async () => ({ from: fakeFrom }) };
});

vi.mock('@/lib/email', () => ({
  sendShareEmail: async (args: { to: string }) => {
    state.emails.push({ to: args.to });
    return { ok: true, id: 'stub-1' };
  },
}));

vi.mock('@/lib/analytics/track', () => ({
  trackEvent: async (event: string) => {
    state.events.push({ event });
    return true;
  },
}));

import { stripe } from '@/lib/stripe';
import { POST } from './route';

/** A `checkout.session.completed` event, as raw JSON text. */
function completedPayload(): string {
  return JSON.stringify({
    id: 'evt_signed_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_signed',
        metadata: {
          gift_id: 'aaaa3333-0000-0000-0000-000000000002',
          buyer_id: '11111111-1111-1111-1111-111111111111',
          delivery_mode: 'send_to_recipient',
          recipient_contact: 'them@example.com',
          session_id: '11111111-2222-4333-8444-555555555555',
        },
        payment_intent: 'pi_test_signed',
        amount_total: 1800,
        currency: 'hkd',
      },
    },
  });
}

function webhookRequest(payload: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature !== null) headers['stripe-signature'] = signature;
  return new Request('https://lovorithm.vercel.app/api/stripe/webhook', {
    method: 'POST',
    headers,
    body: payload,
  });
}

/** Sign a payload the way Stripe signs it, locally. */
function sign(payload: string, secret = WEBHOOK_SECRET): string {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

/** Nothing at all happened: no row, no email, no event. */
function expectNoSideEffects() {
  expect(state.inserted).toHaveLength(0);
  expect(state.emails).toHaveLength(0);
  expect(state.events).toHaveLength(0);
}

beforeEach(() => {
  state.inserted = [];
  state.emails = [];
  state.events = [];
});

describe('POST /api/stripe/webhook — signature verification (OOP-6736)', () => {
  it('accepts a payload signed with the webhook secret', async () => {
    const payload = completedPayload();

    const res = await POST(webhookRequest(payload, sign(payload)));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });

    // The accepted event really did buy something.
    const purchase = state.inserted.find((i) => i.table === 'purchases');
    expect(purchase).toBeDefined();
    expect(purchase?.row).toMatchObject({
      gift_id: 'aaaa3333-0000-0000-0000-000000000002',
      amount_cents: 1800,
      currency: 'HKD',
      status: 'paid',
    });
    expect(state.emails).toHaveLength(1);
  });

  it('rejects a body that was edited after it was signed', async () => {
    // The classic replay: the signature is genuine, but the amount was
    // changed on the way in. The signature covers the body, so this
    // must not be accepted.
    const signed = completedPayload();
    const signature = sign(signed);
    const tampered = signed.replace('"amount_total":1800', '"amount_total":1');

    const res = await POST(webhookRequest(tampered, signature));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('signature verification failed'),
    });
    expectNoSideEffects();
  });

  it('rejects a signature that does not match the body', async () => {
    const payload = completedPayload();
    const [timestamp, v1] = sign(payload).split(',');
    const forgedV1 = v1.replace(/^v1=./, (m) => `v1=${m.charAt(3) === 'a' ? 'b' : 'a'}`);

    const res = await POST(webhookRequest(payload, `${timestamp},${forgedV1}`));

    expect(res.status).toBe(400);
    expectNoSideEffects();
  });

  it('rejects a payload signed with a different secret', async () => {
    const payload = completedPayload();

    const res = await POST(webhookRequest(payload, sign(payload, 'whsec_attacker')));

    expect(res.status).toBe(400);
    expectNoSideEffects();
  });

  it('rejects a request with no signature header', async () => {
    const res = await POST(webhookRequest(completedPayload(), null));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'missing signature' });
    expectNoSideEffects();
  });
});
