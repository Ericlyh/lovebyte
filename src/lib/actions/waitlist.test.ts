import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinWaitlistAction } from './waitlist';

/**
 * Tests for the waitlist server action (OOP-6161 — the Turnstile gate).
 *
 * The Supabase client and the Resend sender are stubbed; the rate
 * limit, the Zod schema and the CAPTCHA gate are the real code path.
 *
 * What has to hold:
 *   - gate off  → the action behaves exactly as before (insert happens)
 *   - gate on   → an unverified request inserts NOTHING
 *   - gate on   → a verified request inserts and sends the autoresponder
 */

const state = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  insertError: null as { code?: string; message: string } | null,
  recent: [] as unknown[],
  rateLimitError: null as { message: string } | null,
  emails: [] as { to: string; locale: string }[],
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({
      'x-forwarded-for': '203.0.113.9',
      'user-agent': 'vitest-agent',
    }),
}));

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: async () => ({
    from: () => ({
      select: () => ({
        or: () => ({
          gte: async () => ({
            data: state.recent,
            error: state.rateLimitError,
          }),
        }),
      }),
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { error: state.insertError };
      },
    }),
  }),
}));

vi.mock('@/lib/email', () => ({
  sendWaitlistEmail: async (args: { to: string; locale: string }) => {
    state.emails.push({ to: args.to, locale: args.locale });
    return { ok: true, id: 'stub-1' };
  },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  state.inserted = [];
  state.insertError = null;
  state.recent = [];
  state.rateLimitError = null;
  state.emails = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Cloudflare says the token is good. */
function cloudflareAccepts() {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  });
}

/** Cloudflare says the token is bad. */
function cloudflareRejects() {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
  });
}

describe('joinWaitlistAction — CAPTCHA gate off (no TURNSTILE_SECRET_KEY)', () => {
  beforeEach(() => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
  });

  it('inserts without contacting Cloudflare', async () => {
    const res = await joinWaitlistAction({ email: 'a@example.com' });

    expect(res).toEqual({ ok: true, status: 'inserted' });
    expect(state.inserted).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the autoresponder', async () => {
    await joinWaitlistAction({ email: 'a@example.com' });

    expect(state.emails).toEqual([{ to: 'a@example.com', locale: 'en' }]);
  });
});

describe('joinWaitlistAction — CAPTCHA gate on (TURNSTILE_SECRET_KEY set)', () => {
  beforeEach(() => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
  });

  it('rejects a submission with no token and inserts nothing', async () => {
    const res = await joinWaitlistAction({ email: 'a@example.com' });

    expect(res.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
  });

  it('rejects a submission Cloudflare refuses and inserts nothing', async () => {
    cloudflareRejects();

    const res = await joinWaitlistAction({
      email: 'a@example.com',
      turnstileToken: 'bad-token',
    });

    expect(res.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
    expect(state.emails).toHaveLength(0);
  });

  it('inserts and sends the autoresponder when Cloudflare accepts', async () => {
    cloudflareAccepts();

    const res = await joinWaitlistAction({
      email: 'a@example.com',
      turnstileToken: 'good-token',
    });

    expect(res).toEqual({ ok: true, status: 'inserted' });
    expect(state.inserted).toHaveLength(1);
    expect(state.emails).toHaveLength(1);
  });

  it('still rate-limits a verified submission', async () => {
    cloudflareAccepts();
    state.recent = [{ id: 'existing' }];

    const res = await joinWaitlistAction({
      email: 'a@example.com',
      turnstileToken: 'good-token',
    });

    expect(res.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });
});
