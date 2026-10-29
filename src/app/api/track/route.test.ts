import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the browser event sink (OOP-6716).
 *
 * The store is stubbed; everything else — the event allowlist, the
 * props schemas (and therefore the PII stripping), the session
 * requirement — is the real code path.
 */

const state = vi.hoisted(() => ({
  recorded: [] as Array<{
    event: string;
    sessionId: string;
    props: Record<string, unknown>;
  }>,
  writeError: null as string | null,
}));

vi.mock('@/lib/analytics/store', () => ({
  recordEvent: async (input: {
    event: string;
    sessionId: string;
    props: Record<string, unknown>;
  }) => {
    if (state.writeError) return { ok: false, error: state.writeError };
    state.recorded.push(input);
    return { ok: true };
  },
}));

const cookie = vi.hoisted(() => ({
  value: '11111111-2222-4333-8444-555555555555' as string | undefined,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'lb-sid' && cookie.value ? { name, value: cookie.value } : undefined,
  }),
  headers: async () => new Headers(),
}));

import { POST } from './route';

function post(body: unknown, raw?: string): Request {
  return new Request('https://lovorithm.vercel.app/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  state.recorded.length = 0;
  state.writeError = null;
  cookie.value = '11111111-2222-4333-8444-555555555555';
});

describe('POST /api/track', () => {
  it('records a client event under the session from the cookie', async () => {
    const res = await POST(post({ event: 'landing_view', props: {} }));

    expect(res.status).toBe(202);
    expect(state.recorded).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({
      event: 'landing_view',
      sessionId: '11111111-2222-4333-8444-555555555555',
    });
  });

  it('refuses to record a server-only event', async () => {
    // A browser that can post `purchase` can fake the whole funnel.
    const res = await POST(post({ event: 'purchase', props: { gift_id: 'x' } }));

    expect(res.status).toBe(400);
    expect(state.recorded).toHaveLength(0);
  });

  it('refuses an unknown event', async () => {
    const res = await POST(post({ event: 'drop_tables', props: {} }));

    expect(res.status).toBe(400);
    expect(state.recorded).toHaveLength(0);
  });

  it('refuses a request with no session', async () => {
    cookie.value = undefined;

    const res = await POST(post({ event: 'landing_view', props: {} }));

    expect(res.status).toBe(400);
    expect(state.recorded).toHaveLength(0);
  });

  it('refuses a malformed body', async () => {
    const res = await POST(post(null, 'not json'));

    expect(res.status).toBe(400);
    expect(state.recorded).toHaveLength(0);
  });

  it('refuses an oversized body', async () => {
    const res = await POST(post(null, JSON.stringify({ event: 'landing_view', pad: 'x'.repeat(5000) })));

    expect(res.status).toBe(413);
    expect(state.recorded).toHaveLength(0);
  });

  it('drops a field the schema does not declare', async () => {
    const res = await POST(
      post({
        event: 'listing_view',
        props: {
          gift_type: 'quiz',
          email: 'someone@example.com',
          share_token: '3f9a1c4e8b2d7f6a5e0c1b9d8a7f6e5d',
        },
      }),
    );

    expect(res.status).toBe(202);
    expect(state.recorded[0]?.props).toEqual({ gift_type: 'quiz' });
    expect(JSON.stringify(state.recorded[0])).not.toContain('example.com');
    expect(JSON.stringify(state.recorded[0])).not.toContain('3f9a1c4e');
  });

  it('redacts a search term server-side', async () => {
    const res = await POST(
      post({ event: 'search', props: { term: 'gift for me@example.com' } }),
    );

    expect(res.status).toBe(202);
    expect(state.recorded[0]?.props.term).toBe('gift for [redacted-email]');
  });

  it('rejects props that do not match the schema', async () => {
    const res = await POST(post({ event: 'cta_click', props: { cta: 'not_a_cta' } }));

    expect(res.status).toBe(400);
    expect(state.recorded).toHaveLength(0);
  });

  it('returns 500 when the store write fails', async () => {
    state.writeError = 'storage 500';

    const res = await POST(post({ event: 'landing_view', props: {} }));

    expect(res.status).toBe(500);
  });
});
