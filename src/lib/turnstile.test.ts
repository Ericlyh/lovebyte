import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { turnstileEnabled, verifyTurnstileToken } from './turnstile';

/**
 * Tests for the Turnstile gate (OOP-6161).
 *
 * The property that matters is fail-CLOSED: once the gate is on, every
 * way the verification can go wrong must reject the request. A gate
 * that can be bypassed by breaking the verify call is not a gate.
 *
 * The module reads `process.env` at call time (not import time), so
 * each test can flip the gate on and off with `vi.stubEnv`.
 */

const ORIGINAL_ENV = { ...process.env };

describe('turnstileEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off when TURNSTILE_SECRET_KEY is unset', () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(turnstileEnabled()).toBe(false);
  });

  it('is on when TURNSTILE_SECRET_KEY is set', () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    expect(turnstileEnabled()).toBe(true);
  });
});

describe('verifyTurnstileToken', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('short-circuits to ok without a network call when the gate is off', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');

    const res = await verifyTurnstileToken({ token: undefined });

    expect(res.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a token Cloudflare reports as successful', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    const res = await verifyTurnstileToken({ token: 'good-token' });

    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('secret')).toBe('secret-key');
    expect(body.get('response')).toBe('good-token');
  });

  it('sends remoteip when the caller has one', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await verifyTurnstileToken({ token: 'good-token', remoteIp: '203.0.113.7' });

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get('remoteip')).toBe('203.0.113.7');
  });

  it('rejects a missing token when the gate is on', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');

    const res = await verifyTurnstileToken({ token: undefined });

    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a blank token when the gate is on', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');

    const res = await verifyTurnstileToken({ token: '   ' });

    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when Cloudflare reports success: false', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    const res = await verifyTurnstileToken({ token: 'bad-token' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('invalid-input-response');
  });

  it('rejects on a non-200 response', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const res = await verifyTurnstileToken({ token: 'good-token' });

    expect(res.ok).toBe(false);
  });

  it('rejects when the network call throws', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    const res = await verifyTurnstileToken({ token: 'good-token' });

    expect(res.ok).toBe(false);
  });

  it('rejects when the response body is malformed', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });

    const res = await verifyTurnstileToken({ token: 'good-token' });

    expect(res.ok).toBe(false);
  });

  it('rejects when the body omits success entirely', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret-key');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const res = await verifyTurnstileToken({ token: 'good-token' });

    expect(res.ok).toBe(false);
  });
});
