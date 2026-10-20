import 'server-only';
import { BRAND } from './brand';

/**
 * Email helpers for transactional delivery (M-E, OOP-4277; waitlist
 * autoresponder, OOP-6156).
 *
 * Single hardcoded provider (Resend) with a `console.log` stub fallback
 * for dev / staging when `RESEND_API_KEY` is unset. This is deliberately
 * not a multi-provider interface — the function signature IS the
 * abstraction; if we ever need Postmark or SES we add a second function
 * alongside this one rather than wrapping providers in a class.
 *
 * Two public senders, one delivery path:
 *
 *   - `sendShareEmail()` — share-link delivery. The webhook
 *     (`/api/stripe/webhook`) calls this for the
 *     `delivery_mode = 'send_to_recipient'` purchase path. The buyer-share
 *     path (`delivery_mode = 'buyer_shares'`) does NOT send an email —
 *     the buyer sees the link at `/purchases`.
 *   - `sendWaitlistEmail()` — waitlist confirmation. Called by
 *     `joinWaitlistAction` after the row is inserted (OOP-6156).
 *
 * Both build their own subject/body — the copy is genuinely different
 * between them — and hand the result to `deliverEmail()`, which owns
 * the Resend call, the stub fallback, and the error shape.
 *
 * URL shape is owned by this module so callers can't drift between dev
 * and prod: `shareToken` is opaque to the caller; we prepend
 * `NEXT_PUBLIC_SITE_URL` here.
 *
 * Env vars are read at CALL time, not at module scope, so a test can
 * `vi.stubEnv` them per case and so a missing `RESEND_API_KEY` shows up
 * at the moment it matters rather than at import time.
 *
 * TODO: SMS / WhatsApp path. The OOP-4277 acceptance criteria is
 * email-only. If/when product confirms the WhatsApp path, add a
 * `sendShareSms()` helper here using Twilio — separate concern,
 * separate function, no abstraction.
 */

type SendShareEmailArgs = {
  /** Recipient email address. */
  to: string;
  /** Gift title — appears in subject + body. */
  giftTitle: string;
  /** Opaque share token (the row PK of `public.shares`). The full URL is built here. */
  shareToken: string;
  /** Display name of the buyer; null renders as "Someone". */
  buyerName: string | null;
  /** Locale for subject + body copy. Defaults to 'en'. */
  locale?: 'en' | 'zh-Hant';
};

type SendWaitlistEmailArgs = {
  /** Recipient email address. */
  to: string;
  /** Locale for subject + body copy. Defaults to 'en'. */
  locale?: 'en' | 'zh-Hant';
};

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/** Which template is being delivered — used for the dev/stub log line. */
type EmailKind = 'share' | 'waitlist';

type DeliverEmailArgs = {
  to: string;
  subject: string;
  text: string;
  kind: EmailKind;
  /** Extra fields for the dev/stub log line only. Never sent to Resend. */
  meta?: Record<string, unknown>;
};

function siteUrl(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return process.env.NEXT_PUBLIC_SITE_URL ?? supabaseUrl ?? 'http://localhost:3000';
}

function buildShareUrl(shareToken: string): string {
  const base = siteUrl().replace(/\/$/, '');
  return `${base}/g/${shareToken}`;
}

function buildSubject(locale: 'en' | 'zh-Hant', giftTitle: string, buyerName: string | null): string {
  const from = buyerName ?? (locale === 'zh-Hant' ? '有人' : 'Someone');
  if (locale === 'zh-Hant') {
    return `${from} 送咗「${giftTitle}」畀你`;
  }
  return `${from} sent you a gift: ${giftTitle}`;
}

function buildBody(locale: 'en' | 'zh-Hant', shareUrl: string, buyerName: string | null): string {
  const from = buyerName ?? (locale === 'zh-Hant' ? '有人' : 'Someone');
  if (locale === 'zh-Hant') {
    return [
      `${from} 喺 ${BRAND.NAME} 送咗一份禮物畀你。`,
      '',
      '按以下連結打開：',
      shareUrl,
      '',
      '（呢個連結係收禮者限定，請勿轉發。）',
    ].join('\n');
  }
  return [
    `${from} sent you a gift on ${BRAND.NAME}.`,
    '',
    'Open it here:',
    shareUrl,
    '',
    '(This link is unique to you — please do not forward it.)',
  ].join('\n');
}

function buildWaitlistSubject(locale: 'en' | 'zh-Hant'): string {
  if (locale === 'zh-Hant') {
    return `你已經加入 ${BRAND.NAME} 候補名單`;
  }
  return `You're on the ${BRAND.NAME} waitlist`;
}

function buildWaitlistBody(locale: 'en' | 'zh-Hant'): string {
  if (locale === 'zh-Hant') {
    return [
      `你已經喺 ${BRAND.NAME} 候補名單上面喇。`,
      '',
      '我哋已經幫你留咗個位。以下係你會收到嘅：',
      `- ${BRAND.NAME} 開放早鳥邀請嘅時候，我哋會 email 你。`,
      '- 冇其他嘢 —— 唔會有電子報，亦唔會有一連串自動 email。',
      '',
      `— ${BRAND.NAME} 團隊`,
    ].join('\n');
  }
  return [
    `You're on the ${BRAND.NAME} waitlist.`,
    '',
    "We've saved your spot. Here's what to expect:",
    `- An invite email when ${BRAND.NAME} opens for early access.`,
    '- Nothing else — no newsletter, no drip sequence.',
    '',
    `— The ${BRAND.NAME} team`,
  ].join('\n');
}

/**
 * Deliver one transactional email through Resend.
 *
 * Returns the Resend message id on success. Falls back to a `stub-*`
 * id when running without `RESEND_API_KEY` so callers can be tested
 * end-to-end without a live ESP.
 */
async function deliverEmail({
  to,
  subject,
  text,
  kind,
  meta,
}: DeliverEmailArgs): Promise<SendEmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM;

  if (!resendApiKey) {
    // Production must fail loud (OOP-6168). A stubbed "sent" id in prod
    // is a lie: the waitlist would tell a visitor they are on the list
    // while no email was ever sent, and a paid gift would never reach
    // its recipient. Dev / test keep the stub so local flows work
    // without a live ESP.
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '[email] RESEND_API_KEY is not set — refusing to report an unsent email as sent',
      );
      return {
        ok: false,
        error: 'RESEND_API_KEY is not set — transactional email is not configured.',
      };
    }
    console.log(`[email/stub] ${kind} email`, { to, subject, ...meta });
    return { ok: true, id: `stub-${Date.now()}` };
  }

  if (!resendFrom) {
    // RESEND_API_KEY is set but no verified sender — refuse rather than
    // sending from a spoofed address.
    return {
      ok: false,
      error: 'RESEND_FROM is not set — refusing to send from an unverified sender.',
    };
  }

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [to],
        subject,
        text,
      }),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, error: `Resend network error: ${(e as Error).message}` };
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    return { ok: false, error: `Resend → HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
  }

  const payload = (await res.json().catch(() => null)) as { id?: string } | null;
  return { ok: true, id: payload?.id ?? `unknown-${Date.now()}` };
}

/**
 * Send a transactional email with the share link.
 */
export async function sendShareEmail(args: SendShareEmailArgs): Promise<SendEmailResult> {
  const locale = args.locale ?? 'en';
  const shareUrl = buildShareUrl(args.shareToken);
  const subject = buildSubject(locale, args.giftTitle, args.buyerName);
  const body = buildBody(locale, shareUrl, args.buyerName);

  return deliverEmail({
    to: args.to,
    subject,
    text: body,
    kind: 'share',
    meta: { shareUrl, buyerName: args.buyerName },
  });
}

/**
 * Send the waitlist confirmation ("you're on the list, here's what to
 * expect") — OOP-6156.
 *
 * Deliberately NOT `sendShareEmail`: that copy says "Someone sent you
 * a gift", which is wrong for a signup confirmation. The two share the
 * delivery path, not the message.
 *
 * The `intent` the requester typed is deliberately NOT echoed into the
 * body — it is free-form user input capped at 64 chars, and putting it
 * in an email means putting it in an inbox we don't control.
 */
export async function sendWaitlistEmail(
  args: SendWaitlistEmailArgs,
): Promise<SendEmailResult> {
  const locale = args.locale ?? 'en';
  const subject = buildWaitlistSubject(locale);
  const body = buildWaitlistBody(locale);

  return deliverEmail({
    to: args.to,
    subject,
    text: body,
    kind: 'waitlist',
    meta: { locale },
  });
}
