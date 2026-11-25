// The Resend sending-domain decision for the readiness gate (OOP-8355).
//
// Exported on its own so the decision this probe makes — "can this
// deployment actually deliver a customer email?" — can be unit-tested
// without running the whole gate (which ends in a Lighthouse sweep over
// every route).
//
// Why this decision exists at all:
//
//   The gate used to ask ONE question about email: is RESEND_API_KEY
//   present, and is RESEND_FROM present? Both could be true — a
//   full-access key, a real from address — while the site still could
//   not email a single customer, because Resend refuses every send from
//   a domain it has not verified, and its sandbox sender
//   (`onboarding@resend.dev`) is accepted only for the ACCOUNT OWNER's
//   own inbox.
//
//   That is the gift-delivery path: CheckoutForm defaults
//   `deliveryMode` to `send_to_recipient`, so a buyer pays, the site
//   says it emailed the gift, and nothing arrives. The gate read all of
//   that as green, because "the key is present" was the only question
//   it asked.
//
// Two gap ids, not one:
//
//   'resend-domain-unverified' — the sender is readable and it is NOT
//     verified. One gap, two states: the sandbox sender and a pending
//     domain are the same defect (no customer email gets out) and the
//     fix is the same (verify a domain).
//
//   'resend-domain-unknown' — the sender could NOT be read: Resend was
//     unreachable, or the deployed route predates the probe. This is a
//     different gap with a different owner (the probe/instrument), and
//     it must never read as "no gaps" — a probe that did not run is not
//     a probe that found nothing.

/** The sender is known and it is not verified. */
export const RESEND_SENDING_GAP = 'resend-domain-unverified';

/** The sender could not be read at all. */
export const RESEND_UNKNOWN_GAP = 'resend-domain-unknown';

/**
 * Decide what the gate should say about the deployed Resend sender.
 *
 * @param {object|null} body  the parsed `/api/readiness` payload
 * @param {object} [opts]
 * @param {string[]} [opts.missing]  the required vars the route reported missing
 * @returns {{verdict: 'ok'|'gap'|'skipped', gapId?: string, message: string}}
 *   'ok'       — the sender is verified; customer email can be delivered
 *   'gap'      — a gap; `gapId` is the stable id the loop files against
 *   'skipped'  — the sender could not be read BECAUSE the key or the
 *                from address is absent, which the missing-var gaps
 *                already cover. Not a gap of its own.
 */
export function assessResendSending(body, { missing = [] } = {}) {
  const mode = body?.resendSendingMode;
  const domain = body?.resendDomain ?? '(none)';
  const absent = (name) => Array.isArray(missing) && missing.includes(name);

  if (mode === 'verified') {
    return {
      verdict: 'ok',
      message: `the deployed RESEND_FROM domain ${domain} is verified in Resend`,
    };
  }

  if (mode === 'sandbox') {
    return {
      verdict: 'gap',
      gapId: RESEND_SENDING_GAP,
      message:
        `the deployed RESEND_FROM (${domain}) is Resend's sandbox sender — it delivers ` +
        `only to the account owner's own inbox, so no customer email ever arrives`,
    };
  }

  if (mode === 'unverified') {
    return {
      verdict: 'gap',
      gapId: RESEND_SENDING_GAP,
      message:
        `the deployed RESEND_FROM domain ${domain} is not verified in Resend — every ` +
        `send to a customer is refused`,
    };
  }

  if (absent('RESEND_API_KEY') || absent('RESEND_FROM')) {
    // The sender or the key is absent, so the sending mode cannot be
    // read. `resend-api-key-missing` / `resend-from-missing` already
    // cover that — no third id needed.
    return {
      verdict: 'skipped',
      message: 'the sending mode cannot be read — the key or the sender is missing',
    };
  }

  if (mode === 'unknown') {
    return {
      verdict: 'gap',
      gapId: RESEND_UNKNOWN_GAP,
      message:
        'the Resend sending-domain probe could not reach Resend — the gate cannot confirm ' +
        'that customer email can be delivered, and an unread probe is not a clean probe',
    };
  }

  // `undefined`: the deployed `/api/readiness` predates the sending
  // probe, so the sending domain cannot be read at all. That is a gap
  // too: the check did not run.
  return {
    verdict: 'gap',
    gapId: RESEND_UNKNOWN_GAP,
    message:
      'the deployed /api/readiness does not report the Resend sending domain — the gate ' +
      'cannot confirm that customer email can be delivered',
  };
}
