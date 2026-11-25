import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * Tests for the env-readiness route (OOP-6168, OOP-7913, OOP-8355).
 *
 * The route reports the NAMES of missing required env vars — never
 * values. That is the whole contract the readiness gate depends on, so
 * the tests pin the two properties that matter: a missing var is named,
 * and a present var is NOT reported (its value must never leak).
 *
 * It also reports MODES derived from the deployed configuration — the
 * Stripe key's mode and kind, and the Resend sender's sending domain.
 * A mode is no more revealing than the var name it is derived from: the
 * Stripe prefix, or the DOMAIN half of the from address (a domain is
 * public — it is in every SPF/DKIM record — while the local part is
 * not, and only the domain is needed to act on the finding).
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  // Start every test from "no Resend configured" so the suite does not
  // depend on whatever happens to be exported in the ambient
  // environment. The probe calls Resend when BOTH of these are present.
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('RESEND_FROM', '');
});

/**
 * Stub Resend's domain list. The probe calls `GET /domains` and reads
 * `data[]`; each entry carries the domain name and its status.
 */
function stubResendDomains(domains: Array<{ name: string; status: string }>) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: domains }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('GET /api/readiness', () => {
  it('names every missing required var', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', '');

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.missing.sort()).toEqual([
      'RESEND_API_KEY',
      'RESEND_FROM',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ]);
  });

  it('reports nothing missing when every var is present, and leaks no value', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_secret_value');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_secret_value');
    vi.stubEnv('RESEND_API_KEY', 're_secret_value');
    vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovorithm.app>');
    stubResendDomains([{ name: 'lovorithm.app', status: 'verified' }]);

    const res = await GET();
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain('sk_live_secret_value');
    expect(raw).not.toContain('whsec_secret_value');
    expect(raw).not.toContain('re_secret_value');
    expect(JSON.parse(raw)).toEqual({
      ok: true,
      missing: [],
      stripeKeyMode: 'live',
      stripeKeyKind: 'full',
      resendSendingMode: 'verified',
      resendDomain: 'lovorithm.app',
      resendDomainStatus: 'verified',
    });
  });

  it('names only the vars that are actually absent', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_secret_value');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_secret_value');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', '');

    const res = await GET();
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.missing.sort()).toEqual(['RESEND_API_KEY', 'RESEND_FROM']);
  });

  // OOP-6168: a deployment carrying a TEST key has every required var
  // present, so `missing` is empty. Reporting only `missing` let the
  // gate read the money path as READY while checkout could not take a
  // real payment — the same false green as the 400-vs-503 webhook
  // branch. The mode is reported so the gate can tell the two apart.
  it('reports the Stripe key mode from its prefix, and never the key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_51SomeTestKeyValue');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x');
    vi.stubEnv('RESEND_API_KEY', 're_x');
    vi.stubEnv('RESEND_FROM', 'onboarding@resend.dev');

    const res = await GET();
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain('sk_test_51SomeTestKeyValue');
    expect(JSON.parse(raw).stripeKeyMode).toBe('test');
  });

  it('reports a restricted live key as live', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'rk_live_someRestrictedKey');

    const res = await GET();
    const body = await res.json();

    expect(body.stripeKeyMode).toBe('live');
  });

  it('reports unknown when the Stripe key is absent', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');

    const res = await GET();
    const body = await res.json();

    expect(body.stripeKeyMode).toBe('unknown');
    expect(body.stripeKeyKind).toBe('unknown');
  });

  // OOP-7913: a RESTRICTED key (`rk_…`) is live-mode, so the mode
  // probe alone cannot tell it from a full one — and Stripe refuses the
  // Connect onboarding endpoints for restricted keys, so the money path
  // is closed even though the key is live (OOP-6168). The kind is
  // reported separately so the gate can catch that false green.
  it('tells a restricted key from a full one, and never leaks either', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'rk_live_someRestrictedKey');

    let res = await GET();
    let raw = JSON.stringify(await res.json());

    expect(raw).not.toContain('rk_live_someRestrictedKey');
    expect(JSON.parse(raw).stripeKeyMode).toBe('live');
    expect(JSON.parse(raw).stripeKeyKind).toBe('restricted');

    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_secret_value');

    res = await GET();
    raw = JSON.stringify(await res.json());

    expect(raw).not.toContain('sk_live_secret_value');
    expect(JSON.parse(raw).stripeKeyMode).toBe('live');
    expect(JSON.parse(raw).stripeKeyKind).toBe('full');
  });

  it('reports the kind independently of the mode', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'rk_test_someRestrictedTestKey');

    let res = await GET();
    let body = await res.json();

    expect(body.stripeKeyMode).toBe('test');
    expect(body.stripeKeyKind).toBe('restricted');

    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_someFullTestKey');

    res = await GET();
    body = await res.json();

    expect(body.stripeKeyMode).toBe('test');
    expect(body.stripeKeyKind).toBe('full');
  });

  it('reports an unrecognised prefix as unknown on both axes', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'pk_live_publishableKey');

    const res = await GET();
    const body = await res.json();

    expect(body.stripeKeyMode).toBe('unknown');
    expect(body.stripeKeyKind).toBe('unknown');
  });

  // OOP-8355: the presence of RESEND_API_KEY and RESEND_FROM is not
  // the same claim as "customer email can be delivered". Resend refuses
  // every send from a domain it has not verified, and its sandbox
  // sender reaches the ACCOUNT OWNER's inbox only — so the gift-link
  // email a buyer pays for never arrives while every presence check
  // passes and the gate reads green.
  describe('the Resend sending-domain probe', () => {
    it('reads the sandbox sender as sandbox, without asking Resend', async () => {
      vi.stubEnv('RESEND_API_KEY', 're_secret_value');
      vi.stubEnv('RESEND_FROM', 'onboarding@resend.dev');

      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      const body = await (await GET()).json();

      expect(body.resendSendingMode).toBe('sandbox');
      expect(body.resendDomain).toBe('resend.dev');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reads a verified sender as verified', async () => {
      vi.stubEnv('RESEND_API_KEY', 're_secret_value');
      vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovebyte.app>');
      stubResendDomains([{ name: 'lovebyte.app', status: 'verified' }]);

      const body = await (await GET()).json();

      expect(body.resendSendingMode).toBe('verified');
      expect(body.resendDomain).toBe('lovebyte.app');
      expect(body.resendDomainStatus).toBe('verified');
    });

    it('reads a sender that is still pending as unverified', async () => {
      vi.stubEnv('RESEND_API_KEY', 're_secret_value');
      vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovebyte.app>');
      stubResendDomains([{ name: 'lovebyte.app', status: 'not_started' }]);

      const body = await (await GET()).json();

      expect(body.resendSendingMode).toBe('unverified');
      expect(body.resendDomain).toBe('lovebyte.app');
      expect(body.resendDomainStatus).toBe('not_started');
    });

    it('reads a sender Resend has never heard of as unverified', async () => {
      vi.stubEnv('RESEND_API_KEY', 're_secret_value');
      vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovebyte.app>');
      stubResendDomains([]);

      const body = await (await GET()).json();

      expect(body.resendSendingMode).toBe('unverified');
      expect(body.resendDomain).toBe('lovebyte.app');
      expect(body.resendDomainStatus).toBe(null);
    });

    // A probe that could not run must not read as a probe that found
    // nothing: an unreachable Resend is 'unknown', and the gate treats
    // that as a gap.
    it('reports unknown when Resend cannot be reached', async () => {
      vi.stubEnv('RESEND_API_KEY', 're_secret_value');
      vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovebyte.app>');
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network down');
        }),
      );

      const body = await (await GET()).json();

      expect(body.resendSendingMode).toBe('unknown');
      expect(body.resendDomain).toBe('lovebyte.app');
    });

    it('reports unknown when Resend answers with an error', async () => {
      vi.stubEnv('RESEND_API_KEY', 're_secret_value');
      vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovebyte.app>');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

      const body = await (await GET()).json();

      expect(body.resendSendingMode).toBe('unknown');
    });

    it('reports unknown when the key or the sender is absent, without asking Resend', async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      let body = await (await GET()).json();
      expect(body.resendSendingMode).toBe('unknown');
      expect(body.resendDomain).toBe(null);

      vi.stubEnv('RESEND_API_KEY', 're_secret_value');

      body = await (await GET()).json();
      expect(body.resendSendingMode).toBe('unknown');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('never leaks the key or the local part of the from address', async () => {
      vi.stubEnv('RESEND_API_KEY', 're_secret_value');
      vi.stubEnv('RESEND_FROM', 'Lovorithm <hello@lovebyte.app>');
      stubResendDomains([{ name: 'lovebyte.app', status: 'verified' }]);

      const raw = JSON.stringify(await (await GET()).json());

      expect(raw).not.toContain('re_secret_value');
      expect(raw).not.toContain('hello@');
      expect(raw).toContain('lovebyte.app');
    });
  });
});
