import { describe, expect, it } from 'vitest';
import {
  assessResendSending,
  RESEND_SENDING_GAP,
  RESEND_UNKNOWN_GAP,
} from './resend-sending-gap.mjs';

/**
 * Tests for the readiness gate's Resend sending-domain decision
 * (OOP-8355).
 *
 * The gate used to ask ONE question about email: is the key present,
 * and is the from address present. Both could be true while the site
 * still could not email a single customer — Resend refuses every send
 * from an unverified domain, and its sandbox sender reaches only the
 * account owner's own inbox. The gate read that as green, so the
 * gift-delivery path (the one a buyer pays for) was invisible to it.
 *
 * Two properties are pinned here:
 *
 *   1. a sender that cannot deliver to a customer is a GAP, with a
 *      stable id the launch loop can file against;
 *   2. a probe that could not run is NOT a pass. An unread probe is a
 *      gap of its own — otherwise a broken probe reads as "no gaps".
 */

describe('assessResendSending', () => {
  it('passes when the sender domain is verified', () => {
    const result = assessResendSending({
      resendSendingMode: 'verified',
      resendDomain: 'lovebyte.app',
    });

    expect(result.verdict).toBe('ok');
    expect(result.gapId).toBeUndefined();
  });

  it('fails when the sender is Resend\'s sandbox address', () => {
    const result = assessResendSending({
      resendSendingMode: 'sandbox',
      resendDomain: 'resend.dev',
    });

    expect(result.verdict).toBe('gap');
    expect(result.gapId).toBe(RESEND_SENDING_GAP);
  });

  it('fails when the sender domain is not verified', () => {
    const result = assessResendSending({
      resendSendingMode: 'unverified',
      resendDomain: 'lovebyte.app',
    });

    expect(result.verdict).toBe('gap');
    expect(result.gapId).toBe(RESEND_SENDING_GAP);
  });

  // The sandbox sender and a pending domain are the same defect — no
  // customer email gets out — so they must share one gap id, or the
  // loop files two issues for one problem.
  it('gives the sandbox and the unverified sender the same gap id', () => {
    const sandbox = assessResendSending({ resendSendingMode: 'sandbox' });
    const unverified = assessResendSending({ resendSendingMode: 'unverified' });

    expect(sandbox.gapId).toBe(unverified.gapId);
  });

  it('fails when the probe could not reach Resend', () => {
    const result = assessResendSending({
      resendSendingMode: 'unknown',
      resendDomain: 'lovebyte.app',
    });

    expect(result.verdict).toBe('gap');
    expect(result.gapId).toBe(RESEND_UNKNOWN_GAP);
  });

  // A deployed route that predates the probe reports no mode at all.
  // That is "the check did not run", not "the check found nothing".
  it('fails when the deployed route does not report a sending mode', () => {
    const result = assessResendSending({ stripeKeyMode: 'live' });

    expect(result.verdict).toBe('gap');
    expect(result.gapId).toBe(RESEND_UNKNOWN_GAP);
  });

  it('skips when the key or the sender is missing — that gap is already filed', () => {
    const noKey = assessResendSending(
      { resendSendingMode: 'unknown' },
      { missing: ['RESEND_API_KEY'] },
    );
    const noSender = assessResendSending(
      { resendSendingMode: 'unknown' },
      { missing: ['RESEND_FROM'] },
    );

    expect(noKey.verdict).toBe('skipped');
    expect(noSender.verdict).toBe('skipped');
  });

  it('still fails on an unverified sender even when another var is missing', () => {
    // A missing Stripe var must not mask a broken sender: they are
    // different gaps, and the sender one is the customer-facing one.
    const result = assessResendSending(
      { resendSendingMode: 'unverified', resendDomain: 'lovebyte.app' },
      { missing: ['STRIPE_SECRET_KEY'] },
    );

    expect(result.verdict).toBe('gap');
    expect(result.gapId).toBe(RESEND_SENDING_GAP);
  });

  it('names the domain in the message, so the finding is actionable', () => {
    const result = assessResendSending({
      resendSendingMode: 'unverified',
      resendDomain: 'lovebyte.app',
    });

    expect(result.message).toContain('lovebyte.app');
  });
});
