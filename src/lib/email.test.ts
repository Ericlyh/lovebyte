import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sendCreatorReplyEmail,
  sendShareEmail,
  sendWaitlistEmail,
} from './email';

/**
 * Tests for the transactional email helpers (OOP-6156).
 *
 * The Resend HTTP call is the only network dependency, so it is stubbed
 * with a fake `fetch`. Everything else — subject/body construction, the
 * stub fallback when `RESEND_API_KEY` is unset, the error shapes — is
 * exercised for real.
 */

// The stub-vs-production branch keys off NODE_ENV, so it is pinned
// rather than inherited — the ambient shell may well export
// NODE_ENV=production (OOP-6168).
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const mock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'resend-123' }),
    text: async () => '',
    ...response,
  }));
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('sendWaitlistEmail', () => {
  it('stubs the send when RESEND_API_KEY is unset (dev / staging)', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', '');

    const result = await sendWaitlistEmail({ to: 'a@example.com' });

    expect(result.ok).toBe(true);
    expect(result.ok && result.id).toMatch(/^stub-/);
  });

  it('refuses to report an unsent email as sent in production (OOP-6168)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', '');

    const result = await sendWaitlistEmail({ to: 'a@example.com' });

    // A stubbed "sent" id in prod is a lie: the waitlist would tell a
    // visitor they are on the list while no email was ever sent.
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/RESEND_API_KEY/);
  });

  it('sends through Resend and returns the message id', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovorithm.app>');
    const fetchMock = stubFetch({});

    const result = await sendWaitlistEmail({ to: 'a@example.com', locale: 'en' });

    expect(result).toEqual({ ok: true, id: 'resend-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer re_test' });

    const payload = JSON.parse(init.body as string);
    expect(payload.from).toBe('Lovorithm <hello@lovorithm.app>');
    expect(payload.to).toEqual(['a@example.com']);
    expect(payload.subject).toContain('waitlist');
    expect(payload.text).toContain("You're on the Lovorithm waitlist.");
    expect(payload.text).toContain('An invite email when Lovorithm opens');
  });

  it('never reuses the share-email copy', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    const fetchMock = stubFetch({});

    await sendWaitlistEmail({ to: 'a@example.com' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(payload.text).not.toContain('sent you a gift');
    expect(payload.subject).not.toContain('sent you a gift');
  });

  it('writes the zh-Hant confirmation in Traditional Chinese', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    const fetchMock = stubFetch({});

    await sendWaitlistEmail({ to: 'a@example.com', locale: 'zh-Hant' });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(payload.subject).toContain('候補名單');
    expect(payload.text).toContain('我哋已經幫你留咗個位');
  });

  it('refuses to send when RESEND_FROM is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', '');
    const fetchMock = stubFetch({});

    const result = await sendWaitlistEmail({ to: 'a@example.com' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('RESEND_FROM is not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a Resend HTTP failure as an error', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    stubFetch({
      ok: false,
      status: 429,
      text: async () => 'Too many requests',
    });

    const result = await sendWaitlistEmail({ to: 'a@example.com' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('Resend → HTTP 429');
  });

  it('surfaces a network failure as an error', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );

    const result = await sendWaitlistEmail({ to: 'a@example.com' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('Resend network error');
  });
});

describe('sendShareEmail', () => {
  it('builds the share URL from NEXT_PUBLIC_SITE_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://lovorithm.app');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    const fetchMock = stubFetch({});

    const result = await sendShareEmail({
      to: 'a@example.com',
      giftTitle: 'A red envelope',
      shareToken: 'tok-123',
      buyerName: 'Mimi',
    });

    expect(result).toEqual({ ok: true, id: 'resend-123' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(payload.subject).toBe('Mimi sent you a gift: A red envelope');
    expect(payload.text).toContain('https://lovorithm.app/g/tok-123');
  });

  it('still stubs when RESEND_API_KEY is unset', async () => {
    vi.stubEnv('RESEND_API_KEY', '');

    const result = await sendShareEmail({
      to: 'a@example.com',
      giftTitle: 'A red envelope',
      shareToken: 'tok-123',
      buyerName: null,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.id).toMatch(/^stub-/);
  });
});

describe('sendCreatorReplyEmail', () => {
  it('sends the reply body and the thread link to the creator', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://lovorithm.app');
    const fetchMock = stubFetch({});

    const result = await sendCreatorReplyEmail({
      to: 'creator@example.com',
      creatorName: 'Mei Chen',
      giftTitle: 'Match the Goa sunsets',
      listingPath: '/l/aaaa1111-0000-0000-0000-000000000001',
      replyerName: 'Jamie',
      replyBody: 'Does it ship to Bangkok?',
    });

    expect(result).toEqual({ ok: true, id: 'resend-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(payload.to).toEqual(['creator@example.com']);
    expect(payload.subject).toBe('New reply about "Match the Goa sunsets"');
    expect(payload.text).toContain('Hi Mei Chen');
    expect(payload.text).toContain('Jamie replied about your gift');
    // The whole point of the email: the creator learns what was asked.
    expect(payload.text).toContain('Does it ship to Bangkok?');
    expect(payload.text).toContain(
      'https://lovorithm.app/l/aaaa1111-0000-0000-0000-000000000001',
    );
  });

  it('falls back to a generic subject when the gift has no title', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    const fetchMock = stubFetch({});

    await sendCreatorReplyEmail({
      to: 'creator@example.com',
      creatorName: null,
      giftTitle: null,
      listingPath: '/l/gift-id',
      replyerName: 'Jamie',
      replyBody: 'Thank you!',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(payload.subject).toBe('New reply about your gift');
    expect(payload.text).toContain('Hi there');
  });

  it('writes the zh-Hant notification in Traditional Chinese', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', 'hello@lovorithm.app');
    const fetchMock = stubFetch({});

    await sendCreatorReplyEmail({
      to: 'creator@example.com',
      creatorName: '陳美',
      giftTitle: ' Goa sunsets',
      listingPath: '/l/gift-id',
      replyerName: 'Jamie',
      replyBody: '會送去曼谷㗎嗎？',
      locale: 'zh-Hant',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(payload.subject).toContain('有人回覆咗');
    expect(payload.text).toContain('陳美');
    expect(payload.text).toContain('會送去曼谷㗎嗎？');
  });

  it('still stubs when RESEND_API_KEY is unset', async () => {
    vi.stubEnv('RESEND_API_KEY', '');

    const result = await sendCreatorReplyEmail({
      to: 'creator@example.com',
      creatorName: 'Mei Chen',
      giftTitle: 'A red envelope',
      listingPath: '/l/gift-id',
      replyerName: 'Jamie',
      replyBody: 'Love it',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.id).toMatch(/^stub-/);
  });

  it('refuses to report an unsent notification as sent in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', '');

    const result = await sendCreatorReplyEmail({
      to: 'creator@example.com',
      creatorName: 'Mei Chen',
      giftTitle: 'A red envelope',
      listingPath: '/l/gift-id',
      replyerName: 'Jamie',
      replyBody: 'Love it',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/RESEND_API_KEY/);
  });
});
