import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import {
  CONNECT_REQUIREMENT_CATEGORIES,
  CONNECT_REQUIREMENT_PHRASES,
  connectRequirementLabel,
  describeConnectRequirements,
  outstandingConnectRequirements,
  payoutsNotReadyMessage,
  type ConnectRequirementCategory,
} from './connect-requirements';

/**
 * OOP-8359 — the onboarding page used to say "Verification in progress
 * — Stripe is verifying your identity" whenever a creator's connected
 * account was not yet charges-enabled. Nothing was being verified: the
 * live probe account's outstanding requirements are
 *
 *     external_account, tos_acceptance.date, tos_acceptance.ip
 *
 * — Stripe is waiting for the CREATOR to add a bank account and accept
 * Stripe's terms. These tests pin that mapping, and that the wording
 * the onboarding page and the publish card use names those two things.
 */

/** The probe account's real requirement set (Stripe live, 2026-11-25). */
const PROBE_REQUIREMENTS = [
  'external_account',
  'tos_acceptance.date',
  'tos_acceptance.ip',
];

describe('outstandingConnectRequirements', () => {
  it('reads the probe account set as a bank account and the Stripe terms', () => {
    expect(outstandingConnectRequirements(PROBE_REQUIREMENTS)).toEqual([
      'bank_account',
      'stripe_terms',
    ]);
  });

  it('treats the two tos_acceptance fields as one requirement', () => {
    // `tos_acceptance.date` and `tos_acceptance.ip` are one thing the
    // creator does — accept the terms — recorded two ways.
    expect(outstandingConnectRequirements(['tos_acceptance.ip'])).toEqual([
      'stripe_terms',
    ]);
    expect(outstandingConnectRequirements(['tos_acceptance.date'])).toEqual([
      'stripe_terms',
    ]);
  });

  it('orders the concrete blockers first and the catch-all last', () => {
    const categories = outstandingConnectRequirements([
      'company.verification.document',
      'external_account',
      'identity_verification.document',
    ]);
    expect(categories).toEqual(['bank_account', 'identity', 'other']);
    expect(categories).toEqual(
      CONNECT_REQUIREMENT_CATEGORIES.filter((c) => categories.includes(c)),
    );
  });

  it('has nothing outstanding for an empty requirement set', () => {
    expect(outstandingConnectRequirements([])).toEqual([]);
    expect(outstandingConnectRequirements(null)).toEqual([]);
    expect(outstandingConnectRequirements(undefined)).toEqual([]);
  });
});

describe('the wording', () => {
  it('names the bank account and the terms acceptance', () => {
    const categories = outstandingConnectRequirements(PROBE_REQUIREMENTS);
    expect(connectRequirementLabel('bank_account')).toBe('Add your bank account.');
    expect(connectRequirementLabel('stripe_terms')).toBe('Accept Stripe’s terms.');
    expect(describeConnectRequirements(categories)).toBe(
      'add your bank account and accept Stripe’s terms',
    );
  });

  it('keeps /onboarding in step with the module (no drift)', () => {
    // The onboarding page renders `Onboarding.connect.requirement.*`;
    // the publish card renders the module's phrases. If the two drift,
    // the two paths stop naming the same thing.
    const requirements = en.Onboarding.connect.requirement as Record<
      ConnectRequirementCategory,
      string
    >;
    for (const category of CONNECT_REQUIREMENT_CATEGORIES) {
      expect(requirements[category]).toBe(connectRequirementLabel(category));
    }
  });

  it('never promises a background check', () => {
    const categories = outstandingConnectRequirements(PROBE_REQUIREMENTS);
    const message = payoutsNotReadyMessage(categories);
    expect(message).toMatch(/add your bank account/);
    expect(message).toMatch(/accept Stripe’s terms/);
    expect(message).not.toMatch(/verifying|still finishing|give it a few seconds/i);
  });

  it('says it could not reach Stripe instead of inventing a state', () => {
    const message = payoutsNotReadyMessage(null);
    expect(message).toMatch(/couldn’t reach Stripe/);
    expect(message).not.toMatch(/verifying|still finishing/i);
  });

  it('has a phrase for every category it can return', () => {
    for (const category of CONNECT_REQUIREMENT_CATEGORIES) {
      expect(CONNECT_REQUIREMENT_PHRASES[category]).toBeTruthy();
    }
  });
});
