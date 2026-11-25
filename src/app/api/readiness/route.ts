import { NextResponse } from 'next/server';

/**
 * GET /api/readiness — which REQUIRED production env vars are missing.
 *
 * The readiness gate (`scripts/readiness-gate.mjs`) can only probe what
 * the deployed site tells it. The Stripe webhook route is such a probe:
 * a bogus signature comes back 400 when the keys are wired, 500 when
 * `STRIPE_WEBHOOK_SECRET` is absent, 503 when `STRIPE_SECRET_KEY` is
 * absent. The Resend side had no probe at all, so a deployment with no
 * `RESEND_API_KEY` looked perfectly healthy while every waitlist
 * autoresponder and every purchase receipt was a silent no-op
 * (OOP-6168).
 *
 * What this route reports:
 *   - the NAMES of missing required env vars — never their values, and
 *     never the value of a var that IS present.
 *   - the names are already public (`.env.example`,
 *     `docs/launch-checklist.md` §1), so this leaks nothing new; what
 *     it adds is the ability to tell "is the money path configured"
 *     from "the site renders".
 *   - `stripeKeyMode` — whether the deployed Stripe key can take REAL
 *     money. See below.
 *   - `stripeKeyKind` — whether that key is a FULL secret key or a
 *     RESTRICTED one. See below.
 *
 * `stripeKeyMode` exists because "the var is present" stopped being
 * the same claim as "the money path works" (OOP-6168). A deployment
 * carrying a TEST key (`sk_test_…`) has every required var present, so
 * `missing` is empty and the gate read the money path as READY — while
 * checkout could not take a single real payment, because a test key
 * never moves money. That is the same class of false green as the
 * 400-vs-503 webhook branch above: the probe reports "configured"
 * about a path that is not.
 *
 * It reports a MODE, never the key: the prefix is turned into
 * 'live' / 'test' / 'unknown' and the key itself is never echoed. That
 * is no more revealing than the var name, which is already public.
 *
 * `stripeKeyKind` is the same probe one level deeper, and it closes a
 * false green the mode probe cannot see (OOP-7913). Stripe reserves the
 * Connect onboarding endpoints — ToS acceptance, external accounts — for
 * FULL secret keys (`sk_…`) and OAuth tokens; a RESTRICTED key (`rk_…`)
 * is refused with `oauth_not_supported` HOWEVER WIDE its scope list
 * (OOP-6168). A restricted key in LIVE mode therefore passes every mode
 * check and still has the creator destination-charge path closed. The
 * kind is reported so the board can read "money is live-mode but not
 * Connect-capable" instead of green.
 *
 * `resendSendingMode` is the EMAIL side of the same problem (OOP-8355).
 * A deployment can carry every required var, pass every presence check,
 * and still be unable to email a single customer: Resend refuses any
 * send from a domain it has not verified, and its sandbox sender
 * (`@resend.dev`) is accepted only for the ACCOUNT OWNER's inbox — so
 * the gift-link email a buyer pays for never reaches the recipient.
 * The domain that `RESEND_FROM` uses is compared against the verified
 * domain list Resend itself reports.
 *
 * `resendDomain` is the DOMAIN part of `RESEND_FROM` — never the full
 * address, never the local part, never the key. The domain is public
 * (it is in every SPF/DKIM record and in the From header of every mail
 * the site sends), and a verdict with no domain attached is not
 * actionable: "the sender is not verified" cannot be turned into work
 * without knowing WHICH domain to verify.
 *
 * `ok` deliberately stays "every required var is present" — it is an
 * ENV claim, not a money claim. Connect being enabled and a creator
 * being onboarded are account state this route cannot see, so widening
 * `ok` to mean "the money path is live" would overclaim. The gate
 * combines `missing` with `stripeKeyMode` instead.
 *
 * The list is a fixed allowlist on purpose: this endpoint must never
 * grow into a dump of the deployment's environment.
 *
 * `dynamic = 'force-dynamic'` matters. A statically prerendered route
 * would freeze the answer at BUILD time — and a build has none of these
 * vars — so every deployment would report all four missing forever.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Vars without which the product cannot do its job. */
const REQUIRED_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM',
] as const;

/**
 * Which Stripe key is deployed, from its PREFIX only.
 *
 *   'live'    — a live-mode key; it can move real money
 *   'test'    — a test-mode key; charges are simulated, nothing is charged
 *   'unknown' — the key is absent, or its prefix is not one Stripe issues
 *
 * Restricted keys (`rk_…`) exist in both modes, so both prefixes are
 * recognised. The key value is never returned by this function.
 */
function stripeKeyMode(): 'live' | 'test' | 'unknown' {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return 'unknown';
  if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) return 'live';
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return 'unknown';
}

/**
 * Which KIND of Stripe key is deployed, from its PREFIX only.
 *
 *   'full'       — a secret key (`sk_…`); may call any Stripe endpoint
 *   'restricted' — a restricted key (`rk_…`); may call only the endpoints
 *                  in its scope list, and Stripe refuses the Connect
 *                  onboarding endpoints for it outright (OOP-6168)
 *   'unknown'    — the key is absent, or its prefix is not one Stripe issues
 *
 * The mode and the kind are independent: `sk_live_` is full+live,
 * `rk_live_` is restricted+live, `sk_test_` is full+test, `rk_test_` is
 * restricted+test. The key value is never returned by this function.
 */
function stripeKeyKind(): 'full' | 'restricted' | 'unknown' {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return 'unknown';
  if (key.startsWith('sk_')) return 'full';
  if (key.startsWith('rk_')) return 'restricted';
  return 'unknown';
}

/**
 * Where the deployment's Resend sender sits.
 *
 *   'verified'   — the sender's domain is a VERIFIED domain in Resend,
 *                  so customer email can actually leave the building.
 *   'unverified' — Resend knows the domain but has not verified it (or
 *                  does not know it at all). Every send to a customer is
 *                  refused with a 403.
 *   'sandbox'    — the sender is Resend's own sandbox address
 *                  (`@resend.dev`). Resend accepts it ONLY for the
 *                  account owner's inbox, so it is unverified for every
 *                  real customer.
 *   'unknown'    — the probe could not be completed: no key, no sender,
 *                  or Resend could not be reached. This must never read
 *                  as "no gaps" — a probe that could not run is not a
 *                  probe that found nothing (OOP-8355).
 */
export type ResendSendingMode = 'verified' | 'unverified' | 'sandbox' | 'unknown';

const RESEND_DOMAINS_URL = 'https://api.resend.com/domains';

/** Give up on the domains call rather than hang a readiness probe. */
const RESEND_PROBE_TIMEOUT_MS = 4000;

/**
 * The DOMAIN part of RESEND_FROM, lowercased — never the full address.
 *
 *   'Lovorithm <hello@lovebyte.app>' -> 'lovebyte.app'
 *   'onboarding@resend.dev'          -> 'resend.dev'
 *
 * The local part and the display name are never reported.
 */
function senderDomain(resendFrom: string | undefined): string | null {
  if (!resendFrom) return null;
  const angled = resendFrom.match(/<([^>]+)>/);
  const address = (angled ? angled[1] : resendFrom).trim();
  const at = address.lastIndexOf('@');
  if (at < 0) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

/**
 * Ask Resend which domains it has verified, and compare that with the
 * domain the site actually sends from.
 *
 * The API KEY is used for the call and never returned. The probe never
 * throws: an unreachable Resend is reported as 'unknown', which the gate
 * treats as a gap rather than as good news.
 */
async function probeResendSending(
  resendFrom: string | undefined,
  resendApiKey: string | undefined,
): Promise<{ mode: ResendSendingMode; domain: string | null; domainStatus: string | null }> {
  const domain = senderDomain(resendFrom);
  const unknown: { mode: ResendSendingMode; domain: string | null; domainStatus: string | null } = {
    mode: 'unknown',
    domain,
    domainStatus: null,
  };

  if (!domain || !resendApiKey) return unknown;

  // Resend's own sandbox sender. No API call is needed to know this,
  // and it is the one state that is ALWAYS wrong for a customer email.
  if (domain === 'resend.dev' || domain.endsWith('.resend.dev')) {
    return { mode: 'sandbox', domain, domainStatus: null };
  }

  let payload: { data?: Array<{ name?: string; status?: string }> } | null = null;
  try {
    const res = await fetch(RESEND_DOMAINS_URL, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(RESEND_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return unknown;
    payload = await res.json();
  } catch {
    // Network error, timeout, or a body that is not JSON.
    return unknown;
  }

  const domains = Array.isArray(payload?.data) ? payload.data : [];
  const mine = domains.find((d) => (d?.name ?? '').trim().toLowerCase() === domain);
  const status = (mine?.status ?? '').trim().toLowerCase() || null;

  if (status === 'verified') {
    return { mode: 'verified', domain, domainStatus: status };
  }
  // Known but not verified (pending / failed / not_started), or unknown to
  // Resend altogether — both mean no customer email gets out.
  return { mode: 'unverified', domain, domainStatus: status };
}

export async function GET() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
  const resend = await probeResendSending(
    process.env.RESEND_FROM,
    process.env.RESEND_API_KEY,
  );

  return NextResponse.json(
    {
      ok: missing.length === 0,
      missing,
      stripeKeyMode: stripeKeyMode(),
      stripeKeyKind: stripeKeyKind(),
      resendSendingMode: resend.mode,
      resendDomain: resend.domain,
      resendDomainStatus: resend.domainStatus,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
