#!/usr/bin/env node
/**
 * Report what Stripe is actually going to do with the money (OOP-8357).
 *
 * The platform account's own payout settings cannot be read-and-fixed
 * with the API — `POST /v1/account` answers 400 "You cannot use this
 * method on your own account: you may only use it on connected
 * accounts." — so the platform half of the payout story is a Dashboard
 * change a human makes. This script is the receipt for it: it prints
 * the state of every account, and exits non-zero while a gap remains.
 *
 * It also answers the question the issue was filed on — "is a
 * creator's money going to move?" — which is NOT the platform's
 * schedule. A connected account gets Stripe's own default
 * (`interval: daily`) unless it is given one, so a creator is paid
 * automatically whether or not the platform's schedule is manual. What
 * actually stops a payout is `payouts_enabled` and the account's
 * outstanding `requirements`, which only the creator can clear.
 *
 * Run it with a key that can read the platform account:
 *
 *   STRIPE_SECRET_KEY=sk_... node scripts/stripe-payout-audit.mjs
 *
 * Exit code 0 = no gaps, 1 = at least one gap (see the GAPS section).
 */
const KEY =
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_LOVORITHM_TRUE_FULL_ACCESS ||
  process.env.STRIPE_SECRET_LEY;

if (!KEY) {
  console.error(
    'No Stripe key. Set STRIPE_SECRET_KEY (or STRIPE_LOVORITHM_TRUE_FULL_ACCESS).',
  );
  process.exit(2);
}

const API = 'https://api.stripe.com/v1';
const DESCRIPTOR = 'LOVORITHM';
const gaps = [];

async function get(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status} ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function line(label, value) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

const platform = await get('/account');
const balance = await get('/balance');
const accounts = await get('/accounts?limit=50');

console.log(`platform account ${platform.id} (${platform.default_currency})`);
line('charges / payouts', `${platform.charges_enabled} / ${platform.payouts_enabled}`);
line('balance available', JSON.stringify(balance.available ?? []));
line('balance pending', JSON.stringify(balance.pending ?? []));
line('balance connect reserved', JSON.stringify(balance.connect_reserved ?? []));
line('transfers capability', platform.capabilities?.transfers ?? 'unknown');

const platformSchedule = platform.settings?.payouts?.schedule;
line('payout schedule', JSON.stringify(platformSchedule));
line(
  'payout descriptor',
  JSON.stringify(platform.settings?.payouts?.statement_descriptor),
);
line(
  'card descriptor prefix',
  JSON.stringify(platform.settings?.card_payments?.statement_descriptor_prefix),
);

if (platformSchedule?.interval !== 'daily') {
  gaps.push(
    `platform payout schedule is ${platformSchedule?.interval ?? 'unset'} — Dashboard > Settings > Payouts > set interval to daily so the platform's fee revenue moves without a manual request`,
  );
}
if (platform.settings?.payouts?.statement_descriptor !== DESCRIPTOR) {
  gaps.push(
    `platform payout statement_descriptor is ${JSON.stringify(platform.settings?.payouts?.statement_descriptor)} — Dashboard > Settings > Branding > set it to ${DESCRIPTOR}`,
  );
}
if (platform.settings?.card_payments?.statement_descriptor_prefix !== DESCRIPTOR) {
  gaps.push(
    `platform card statement_descriptor_prefix is ${JSON.stringify(platform.settings?.card_payments?.statement_descriptor_prefix)} — Dashboard > Settings > Branding > set it to ${DESCRIPTOR}`,
  );
}

console.log(`\nconnected accounts (${accounts.data?.length ?? 0})`);
for (const account of accounts.data ?? []) {
  console.log(`\n${account.id}  type=${account.type}  metadata=${JSON.stringify(account.metadata)}`);
  line('created', new Date(account.created * 1000).toISOString());
  line('charges / payouts', `${account.charges_enabled} / ${account.payouts_enabled}`);
  line('payout schedule', JSON.stringify(account.settings?.payouts?.schedule));
  line(
    'payout descriptor',
    JSON.stringify(account.settings?.payouts?.statement_descriptor),
  );
  line(
    'card descriptor prefix',
    JSON.stringify(account.settings?.card_payments?.statement_descriptor_prefix),
  );
  line('balance available', JSON.stringify(account.balance?.available ?? []));
  line('requirements due', JSON.stringify(account.requirements?.currently_due ?? []));
  line('disabled reason', account.requirements?.disabled_reason ?? 'none');

  // A creator's payout only happens if Stripe can move their money.
  if (!account.payouts_enabled) {
    gaps.push(
      `${account.id} is not payout-enabled (${account.requirements?.disabled_reason ?? 'unknown'}); the creator must clear ${(account.requirements?.currently_due ?? []).join(', ') || 'its outstanding requirements'} in Stripe-hosted onboarding`,
    );
  }
}

console.log(`\nGAPS (${gaps.length})`);
for (const gap of gaps) console.log(`  - ${gap}`);

process.exit(gaps.length ? 1 : 0);
