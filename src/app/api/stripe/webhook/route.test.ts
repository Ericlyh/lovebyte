import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the funnel event the Stripe webhook records (OOP-6716).
 *
 * The paid `purchase` step of the funnel cannot be exercised against
 * production — the Stripe keys are missing on every environment until
 * OOP-6168 lands — so this is the only place the behaviour is pinned.
 *
 * What matters here is the SESSION CORRELATION: the webhook request
 * carries no browser cookie, so the analytics session id has to travel
 * with the payment, on the Stripe metadata. If that link breaks, a
 * purchase is filed under a session of its own and never joins the
 * buyer's earlier steps — the funnel would report a purchase that no
 * browsing session ever reached.
 */

const state = vi.hoisted(() => ({
  inserted: [] as { table: string; row: Record<string, unknown> }[],
  events: [] as {
    event: string;
    props: Record<string, unknown>;
    sessionId?: string;
  }[],
  emails: [] as { to: string }[],
  event: null as { id: string; type: string; data: { object: unknown } } | null,
}));

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: () => state.event,
    },
    paymentIntents: {
      retrieve: async () => ({ application_fee_amount: 180 }),
    },
  },
}));

vi.mock('@/lib/supabase/service-role', () => {
  const selectData = (table: string): Record<string, unknown> | null => {
    if (table === 'gifts') return { title: 'Trivia of our first year', platform_fee_bps: 1000 };
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
  trackEvent: async (
    event: string,
    props: Record<string, unknown>,
    opts?: { sessionId?: string },
  ) => {
    state.events.push({ event, props, sessionId: opts?.sessionId });
    return true;
  },
}));

import { POST } from './route';

const SESSION_ID = '11111111-2222-4333-8444-555555555555';

function webhookRequest(): Request {
  return new Request('https://lovorithm.vercel.app/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': 't=1,v1=abc', 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'evt_1' }),
  });
}

function completedSession(metadata: Record<string, string>) {
  return {
    id: 'cs_test_1',
    metadata,
    payment_intent: 'pi_test_1',
    amount_total: 1800,
    currency: 'hkd',
  };
}

beforeEach(() => {
  state.inserted = [];
  state.events = [];
  state.emails = [];
  state.event = null;
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/stripe/webhook — the purchase event (OOP-6716)', () => {
  it('records a purchase under the session carried on the Stripe metadata', async () => {
    state.event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: completedSession({
          gift_id: 'aaaa3333-0000-0000-0000-000000000002',
          buyer_id: '11111111-1111-1111-1111-111111111111',
          delivery_mode: 'send_to_recipient',
          recipient_contact: 'them@example.com',
          session_id: SESSION_ID,
        }),
      },
    };

    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.event).toBe('purchase');
    expect(state.events[0]?.props).toMatchObject({
      gift_id: 'aaaa3333-0000-0000-0000-000000000002',
      amount_cents: 1800,
      currency: 'HKD',
      free: false,
    });
    // The session id is what joins this purchase to the buyer's
    // earlier steps — it must survive the round trip through Stripe.
    expect(state.events[0]?.sessionId).toBe(SESSION_ID);
  });

  it('records no purchase when the session metadata is incomplete', async () => {
    state.event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: completedSession({
          gift_id: 'aaaa3333-0000-0000-0000-000000000002',
          // no buyer_id, no delivery_mode
        }),
      },
    };

    const res = await POST(webhookRequest());

    expect(res.status).toBe(200);
    expect(state.events).toHaveLength(0);
  });

  it('records no purchase for an invalid delivery mode', async () => {
    state.event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: completedSession({
          gift_id: 'aaaa3333-0000-0000-0000-000000000002',
          buyer_id: '11111111-1111-1111-1111-111111111111',
          delivery_mode: 'steal_it',
          session_id: SESSION_ID,
        }),
      },
    };

    await POST(webhookRequest());

    expect(state.events).toHaveLength(0);
  });

  it('records no purchase for an event type it does not handle', async () => {
    state.event = { id: 'evt_2', type: 'invoice.paid', data: { object: {} } };

    await POST(webhookRequest());

    expect(state.events).toHaveLength(0);
  });

  it('still writes the purchase row', async () => {
    state.event = {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: completedSession({
          gift_id: 'aaaa3333-0000-0000-0000-000000000002',
          buyer_id: '11111111-1111-1111-1111-111111111111',
          delivery_mode: 'buyer_shares',
          session_id: SESSION_ID,
        }),
      },
    };

    await POST(webhookRequest());

    const purchase = state.inserted.find((i) => i.table === 'purchases');
    expect(purchase).toBeDefined();
    expect(purchase?.row).toMatchObject({
      gift_id: 'aaaa3333-0000-0000-0000-000000000002',
      amount_cents: 1800,
      currency: 'HKD',
      status: 'paid',
    });
  });
});
