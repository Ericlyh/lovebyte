import 'server-only';
import { BRAND } from './brand';

/**
 * Email helper for transactional share-link delivery (M-E, OOP-4277).
 *
 * Single hardcoded provider (Resend) with a `console.log` stub fallback
 * for dev / staging when `RESEND_API_KEY` is unset. This is deliberately
 * not a multi-provider interface — the function signature IS the
 * abstraction; if we ever need Postmark or SES we add a second function
 * alongside this one rather than wrapping providers in a class.
 *
 * The webhook (`/api/stripe/webhook`) calls this for the
 * `delivery_mode = 'send_to_recipient'` purchase path. The buyer-share
 * path (`delivery_mode = 'buyer_shares'`) does NOT send an email — the
 * buyer sees the link at `/purchases`.
 *
 * URL shape is owned by this module so callers can't drift between dev
 * and prod: `shareToken` is opaque to the caller; we prepend
 * `NEXT_PUBLIC_SITE_URL` here.
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

export type SendShareEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? SUPABASE_URL ?? 'http://localhost:3000';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;

function buildShareUrl(shareToken: string): string {
  const base = SITE_URL.replace(/\/$/, '');
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

/**
 * Send a transactional email with the share link.
 *
 * Returns the Resend message id on success. Falls back to a `stub-*`
 * id when running without `RESEND_API_KEY` so callers can be tested
 * end-to-end without a live ESP.
 */
export async function sendShareEmail(args: SendShareEmailArgs): Promise<SendShareEmailResult> {
  const locale = args.locale ?? 'en';
  const shareUrl = buildShareUrl(args.shareToken);
  const subject = buildSubject(locale, args.giftTitle, args.buyerName);
  const body = buildBody(locale, shareUrl, args.buyerName);

  if (!RESEND_API_KEY) {
    // Dev / staging fallback — never ship to prod without this set.
    // Production builds should fail loud here, but for now we log so
    // webhook flows still complete end-to-end during local testing.
    console.log('[email/stub] share email', {
      to: args.to,
      subject,
      shareUrl,
      buyerName: args.buyerName,
    });
    return { ok: true, id: `stub-${Date.now()}` };
  }

  if (!RESEND_FROM) {
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
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [args.to],
        subject,
        text: body,
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
