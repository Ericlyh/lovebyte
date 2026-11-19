import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * Tests for the env-readiness route (OOP-6168).
 *
 * The route reports the NAMES of missing required env vars — never
 * values. That is the whole contract the readiness gate depends on, so
 * the tests pin the two properties that matter: a missing var is named,
 * and a present var is NOT reported (its value must never leak).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

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
  // probe alone cannot tell it from a full key — and Stripe refuses the
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
});
