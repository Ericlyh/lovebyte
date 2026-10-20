import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { PATCH } from './[id]/route';

/**
 * Tests for the status-page admin routes (OOP-6156).
 *
 * The Supabase service-role client is stubbed; everything else — the
 * auth gate, the Zod schemas, the `resolved_at` derivation — is the
 * real code path.
 */

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  insertError: null as { message: string } | null,
  updateData: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: async () => ({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: state.insertError
                ? null
                : {
                    id: '11111111-2222-3333-4444-555555555555',
                    created_at: '2026-10-20T00:00:00.000Z',
                    updated_at: '2026-10-20T00:00:00.000Z',
                    ...row,
                  },
              error: state.insertError,
            }),
          }),
        };
      },
      update: (patch: Record<string, unknown>) => {
        state.updated.push(patch);
        return {
          eq: () => ({
            select: () => ({
              maybeSingle: async () => ({
                data: state.updateData,
                error: null,
              }),
            }),
          }),
        };
      },
    }),
  }),
}));

const TOKEN = 'test-incident-token';

function authedRequest(body: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request('https://lovebyte-five.vercel.app/api/incidents', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.inserted.length = 0;
  state.updated.length = 0;
  state.insertError = null;
  state.updateData = null;
  vi.stubEnv('INCIDENT_ADMIN_TOKEN', TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/incidents', () => {
  it('fails closed when INCIDENT_ADMIN_TOKEN is not configured', async () => {
    vi.stubEnv('INCIDENT_ADMIN_TOKEN', '');

    const res = await POST(authedRequest({ severity: 'outage', title: 'Down' }, null));

    expect(res.status).toBe(503);
    expect(state.inserted).toHaveLength(0);
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await POST(authedRequest({ severity: 'outage', title: 'Down' }, null));

    expect(res.status).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });

  it('rejects a request with the wrong token', async () => {
    const res = await POST(authedRequest({ severity: 'outage', title: 'Down' }, 'nope'));

    expect(res.status).toBe(401);
    expect(state.inserted).toHaveLength(0);
  });

  it('rejects an unknown severity', async () => {
    const res = await POST(authedRequest({ severity: 'catastrophic', title: 'Down' }));

    expect(res.status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });

  it('rejects an empty title', async () => {
    const res = await POST(authedRequest({ severity: 'outage', title: '   ' }));

    expect(res.status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });

  it('rejects a malformed JSON body', async () => {
    const res = await POST(
      new Request('https://lovebyte-five.vercel.app/api/incidents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: 'not json',
      }),
    );

    expect(res.status).toBe(400);
    expect(state.inserted).toHaveLength(0);
  });

  it('logs the incident', async () => {
    const res = await POST(
      authedRequest({
        severity: 'degraded',
        title: 'Elevated 502s on /create',
        body: 'Looking into it.',
      }),
    );

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.incident.title).toBe('Elevated 502s on /create');

    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      severity: 'degraded',
      title: 'Elevated 502s on /create',
      body: 'Looking into it.',
      status: 'investigating',
      resolved_at: null,
    });
  });

  it('defaults an empty body to null', async () => {
    await POST(authedRequest({ severity: 'outage', title: 'Down', body: '' }));

    expect(state.inserted[0]?.body).toBeNull();
  });

  it('stamps resolved_at when the incident is created already resolved', async () => {
    await POST(authedRequest({ severity: 'outage', title: 'Down', status: 'resolved' }));

    expect(state.inserted[0]?.status).toBe('resolved');
    expect(state.inserted[0]?.resolved_at).toEqual(expect.any(String));
  });

  it('returns 500 when the insert fails', async () => {
    state.insertError = { message: 'connection refused' };

    const res = await POST(authedRequest({ severity: 'outage', title: 'Down' }));

    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/incidents/[id]', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  function patchRequest(body: unknown, token: string | null = TOKEN): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    return new Request(`https://lovebyte-five.vercel.app/api/incidents/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
  }

  it('rejects a request with no Authorization header', async () => {
    const res = await PATCH(patchRequest({ status: 'resolved' }, null), {
      params: Promise.resolve({ id }),
    });

    expect(res.status).toBe(401);
    expect(state.updated).toHaveLength(0);
  });

  it('rejects an id that is not a UUID', async () => {
    const res = await PATCH(patchRequest({ status: 'resolved' }), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(res.status).toBe(400);
    expect(state.updated).toHaveLength(0);
  });

  it('rejects an empty update', async () => {
    const res = await PATCH(patchRequest({}), {
      params: Promise.resolve({ id }),
    });

    expect(res.status).toBe(400);
    expect(state.updated).toHaveLength(0);
  });

  it('closes an incident by setting status to resolved', async () => {
    state.updateData = { id, status: 'resolved', resolved_at: '2026-10-20T00:00:00.000Z' };

    const res = await PATCH(patchRequest({ status: 'resolved' }), {
      params: Promise.resolve({ id }),
    });

    expect(res.status).toBe(200);
    expect(state.updated[0]).toMatchObject({ status: 'resolved' });
    expect(state.updated[0]?.resolved_at).toEqual(expect.any(String));
  });

  it('reopens a resolved incident by setting any other status', async () => {
    state.updateData = { id, status: 'monitoring', resolved_at: null };

    const res = await PATCH(patchRequest({ status: 'monitoring' }), {
      params: Promise.resolve({ id }),
    });

    expect(res.status).toBe(200);
    expect(state.updated[0]).toMatchObject({ status: 'monitoring', resolved_at: null });
  });

  it('leaves resolved_at alone when status is not supplied', async () => {
    state.updateData = { id, title: 'Renamed' };

    const res = await PATCH(patchRequest({ title: 'Renamed' }), {
      params: Promise.resolve({ id }),
    });

    expect(res.status).toBe(200);
    expect(state.updated[0]).toEqual({ title: 'Renamed' });
  });

  it('returns 404 when there is no such incident', async () => {
    state.updateData = null;

    const res = await PATCH(patchRequest({ status: 'resolved' }), {
      params: Promise.resolve({ id }),
    });

    expect(res.status).toBe(404);
  });
});
