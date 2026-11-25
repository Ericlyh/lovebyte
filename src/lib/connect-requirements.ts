/**
 * OOP-8359 — what Stripe is actually waiting for.
 *
 * The onboarding page used to say "Verification in progress — Stripe is
 * verifying your identity" whenever a creator's connected account was
 * not yet charges-enabled. That described a background process that does
 * not exist. The live probe account's outstanding requirements are
 *
 *     external_account, tos_acceptance.date, tos_acceptance.ip
 *
 * — Stripe is waiting for the CREATOR to add a bank account and accept
 * Stripe's terms. A creator who is told to wait waits forever, because
 * nothing is being verified while they wait.
 *
 * So both the onboarding page and the publish card ask Stripe what is
 * outstanding and say it in those words. This module is the single
 * mapping from Stripe's requirement codes to what the creator has to
 * do, and the single source of the wording both paths use. It is pure,
 * so both callers share it and a test can pin it.
 */

/**
 * The things a creator can be asked for. Ordered the way they are
 * shown: the concrete blockers first, the catch-all last.
 */
export type ConnectRequirementCategory =
  | 'bank_account'
  | 'stripe_terms'
  | 'identity'
  | 'other';

export const CONNECT_REQUIREMENT_CATEGORIES: readonly ConnectRequirementCategory[] = [
  'bank_account',
  'stripe_terms',
  'identity',
  'other',
];

/**
 * The English phrase for each requirement — an imperative, so it reads
 * both as a list item ("Add your bank account.") and as the tail of
 * "Stripe still needs you to …".
 *
 * `en.json` carries the capitalised sentence form of these phrases, and
 * `connect-requirements.test.ts` fails if the two drift apart, so the
 * onboarding page and the publish card always name the same thing.
 */
export const CONNECT_REQUIREMENT_PHRASES: Record<ConnectRequirementCategory, string> = {
  bank_account: 'add your bank account',
  stripe_terms: 'accept Stripe’s terms',
  identity: 'verify your identity',
  other: 'finish the remaining checks in Stripe',
};

/**
 * Stripe's requirement code → the category we show it under.
 *
 * `external_account` is the payout destination — the bank account.
 * `tos_acceptance.date` and `tos_acceptance.ip` are one requirement
 * with two fields: Stripe records when, and from where, the creator
 * accepted its terms.
 */
function categoryForRequirement(code: string): ConnectRequirementCategory {
  if (code === 'external_account') return 'bank_account';
  if (code.startsWith('tos_acceptance')) return 'stripe_terms';
  if (
    code.startsWith('identity_verification') ||
    code.startsWith('individual.verification') ||
    code.startsWith('representative.')
  ) {
    return 'identity';
  }
  return 'other';
}

/**
 * The categories a creator still has to complete, deduplicated and in
 * display order.
 *
 * `tos_acceptance.date` and `tos_acceptance.ip` both land on
 * `stripe_terms`, so the creator is told to accept the terms once, not
 * twice.
 */
export function outstandingConnectRequirements(
  currentlyDue: readonly string[] | null | undefined,
): ConnectRequirementCategory[] {
  if (!currentlyDue?.length) return [];
  const outstanding = new Set<ConnectRequirementCategory>();
  for (const code of currentlyDue) {
    outstanding.add(categoryForRequirement(code));
  }
  return CONNECT_REQUIREMENT_CATEGORIES.filter((c) => outstanding.has(c));
}

/**
 * The list item for one category: "Add your bank account."
 */
export function connectRequirementLabel(category: ConnectRequirementCategory): string {
  const phrase = CONNECT_REQUIREMENT_PHRASES[category];
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

/**
 * The one-line form, for the publish card, which has room for a message
 * but not for a list: "add your bank account and accept Stripe’s terms".
 */
export function describeConnectRequirements(
  categories: readonly ConnectRequirementCategory[],
): string {
  const phrases = categories.map((c) => CONNECT_REQUIREMENT_PHRASES[c]);
  if (phrases.length === 0) return '';
  if (phrases.length === 1) return phrases[0];
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`;
}

/**
 * The message the publish card shows when a paid listing cannot go up
 * yet.
 *
 * It names what the creator still has to do. It never says Stripe is
 * "verifying" or "finishing" something — nothing runs in the background,
 * and a creator told to wait waits forever.
 *
 * `categories` is `null` when Stripe could not be reached at all: we do
 * not know what it wants then, and saying so is the honest answer.
 */
export function payoutsNotReadyMessage(
  categories: readonly ConnectRequirementCategory[] | null,
): string {
  if (categories === null) {
    return 'We couldn’t reach Stripe to check your payouts. Open Stripe to finish your payout setup — you can return to it at any time — then press Publish again.';
  }
  if (categories.length === 0) {
    return 'Stripe hasn’t enabled payouts for your account. Open Stripe to see what it still needs — you can return to it at any time — then press Publish again.';
  }
  return `Stripe still needs you to ${describeConnectRequirements(categories)} before buyers can pay you. Open Stripe to finish — you can return to it at any time — then press Publish again.`;
}
