import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUnreachable, supabaseFetch, unreachableError } from './net';

/**
 * Tests for the Supabase network policy (OOP-5816).
 *
 * The bug this pins: `@supabase/postgrest-js` retries an idempotent
 * request up to 3 times with 1s / 2s / 4s of backoff, and it cannot
 * tell "the host is unreachable" from "the host is briefly down". When
 * the Supabase project host stopped resolving, that turned a 3ms DNS
 * failure into a 7.3-second failure — and `/browse` into a blank white
 * page for 6.5 seconds.
 *
 * `supabaseFetch` re-throws an unreachable-host failure as an
 * `AbortError`, which is the one error postgrest-js does not retry.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fetch rejection shaped like undici's for a dead DNS record. */
function unreachableRejection() {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause: { code: string; message: string } }).cause = {
    code: 'ENOTFOUND',
    message: 'getaddrinfo ENOTFOUND xsfbfqzmvjfxppvoxbze.supabase.co',
  };
  return err;
}

describe('isUnreachable', () => {
  it('is true for a DNS failure', () => {
    expect(isUnreachable(unreachableRejection())).toBe(true);
  });

  it('is true for a refused connection', () => {
    const err = new TypeError('fetch failed');
    (err as TypeError & { cause: { code: string } }).cause = { code: 'ECONNREFUSED' };
    expect(isUnreachable(err)).toBe(true);
  });

  it('is false for an AbortError — that is our own deadline, not an unreachable host', () => {
    expect(isUnreachable(new DOMException('deadline', 'AbortError'))).toBe(false);
  });

  it('is false for a transient mid-request failure', () => {
    const err = new TypeError('fetch failed');
    (err as TypeError & { cause: { code: string } }).cause = { code: 'ECONNRESET' };
    expect(isUnreachable(err)).toBe(false);
  });

  it('is false for an ordinary error', () => {
    expect(isUnreachable(new Error('nope'))).toBe(false);
  });
});

describe('unreachableError', () => {
  it('is an AbortError so postgrest-js does not retry it', () => {
    const err = unreachableError(unreachableRejection());
    expect(err.name).toBe('AbortError');
    expect(err.message).toContain('ENOTFOUND');
  });
});

describe('supabaseFetch', () => {
  it('re-throws an unreachable host as an AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw unreachableRejection();
    }));

    await expect(supabaseFetch('https://x.supabase.co/rest/v1/gifts')).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
  });

  it('passes an ordinary error through untouched', async () => {
    const original = new Error('boom');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw original;
    }));

    await expect(supabaseFetch('https://x.supabase.co/rest/v1/gifts')).rejects.toBe(original);
  });

  it('does not retry an unreachable host', async () => {
    // The regression that matters: postgrest-js used to call fetch 4
    // times (1 + 3 retries with 1s/2s/4s backoff = 7.3s) for a host
    // that was never going to answer.
    const fetchMock = vi.fn(async () => {
      throw unreachableRejection();
    });
    vi.stubGlobal('fetch', fetchMock);

    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient('https://x.supabase.co', 'sb_publishable_test', {
      global: { fetch: supabaseFetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const started = Date.now();
    const { error } = await client.from('gifts').select('id').limit(1);
    const elapsed = Date.now() - started;

    expect(error).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The old behaviour spent 7s in backoff before the first failure.
    expect(elapsed).toBeLessThan(1000);
  });

  it('gives reads and writes a deadline but exempts Storage uploads', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init: RequestInit) => {
      signals.push(init.signal);
      return new Response('{}', { status: 200 });
    }));

    await supabaseFetch('https://x.supabase.co/rest/v1/gifts', { method: 'GET' });
    await supabaseFetch('https://x.supabase.co/rest/v1/gifts', { method: 'POST' });
    await supabaseFetch('https://x.supabase.co/storage/v1/object', { method: 'POST' });

    // A read and a write are both bounded; a 50MB upload must not be
    // cut off by a deadline.
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[2]).toBeUndefined();
  });
});
