import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEnvelopeByToken } from '@/lib/gifts/fetch';
import { BRAND } from '@/lib/brand';

/**
 * /g/[shareToken] — recipient envelope view (Phase 3, architecture §2).
 *
 * Most-shared surface in the app. Renders the envelope from
 * design/03-mockups/recipient-view.html.
 *
 * Data: src/lib/gifts/fetch.ts — falls back to mock seed until the
 * Supabase Cloud project is provisioned (OOP-4211 blocker #2).
 *
 * Runtime: nodejs, not edge (OOP-5816, 2026-10-20). This route was on
 * the Edge Runtime under the OOP-4211 "hard constraint" — a constraint
 * inherited from the Next 15-era architecture, on a project that now
 * runs Next 16.3.2, where the Edge Runtime is DEPRECATED and Next
 * itself says to use 'nodejs'. A previous run flagged the deprecation
 * for a decision; this is that decision.
 *
 * The measurement that settled it: the edge isolate resolves DNS in a
 * way that blocks the whole isolate, and it does not observe an abort
 * signal. So when the Supabase project host stopped resolving, this
 * page took 8.0s to produce its markup — the visitor saw a blank
 * white page — and no timeout could interrupt it, because the isolate
 * was blocked. The same read on the Node runtime fails in 3ms: the
 * Node runtime reports ENOTFOUND immediately and the network policy in
 * src/lib/supabase/net.ts short-circuits it (7052ms -> 7ms measured).
 * Every other route in this app is already 'nodejs'.
 *
 * Reverting: put `export const runtime = 'edge'` back. The cost is
 * that a sick data layer takes this page down with it again.
 *
 * ## Why there is no `loading.tsx` here (OOP-6729)
 *
 * The segment used to carry a `loading.tsx`. That file is not a
 * cosmetic choice — it is a `<Suspense>` boundary AROUND this page,
 * and a Suspense boundary lets Next.js flush the response shell (the
 * loading skeleton, HTTP 200) before this page's `notFound()` ever
 * runs. So an unknown share token was served as a real page with a
 * 200: the "Gift not found" page, indexable, on an endless URL space
 * of share tokens.
 *
 * The fix is the order of operations: the existence check has to
 * happen BEFORE anything is flushed, so it happens at the top of the
 * page and throws `notFound()`. The check was already here — it just
 * had no way of reaching the status code.
 *
 * The cost is the streaming skeleton. The envelope read IS the
 * existence check, so there is nothing left to stream behind a
 * boundary once the check has passed: the recipient waits for the
 * envelope and then sees it. `/u/[handle]`, which has always returned
 * a real 404, behaves the same way.
 */

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ locale: string; token: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const envelope = await getEnvelopeByToken(token);
  // Phase 9 (OOP-4225) — if the token doesn't resolve, propagate
  // notFound() from generateMetadata too. Without this, generateMetadata
  // returns a fallback title and Next.js commits the response status
  // to 200 before the page-level notFound() throws, leaving the
  // /g/[token] not-found surface served as HTTP 200 (cosmetic bug
  // — the leaf not-found.tsx still renders, but crawlers see 200).
  if (!envelope) notFound();
  const ogUrl = `/api/og/${encodeURIComponent(token)}`;
  return {
    title: `${envelope.senderName} sent you something — ${BRAND.NAME}`,
    description:
      envelope.coverText ??
      `${envelope.senderName} sent you a one-of-a-kind gift on ${BRAND.NAME}.`,
    openGraph: {
      title: `${envelope.senderName} sent you something`,
      description:
        envelope.coverText ?? `Open your gift on ${BRAND.NAME}.`,
      images: [{ url: ogUrl, width: 1200, height: 630 }],
      type: 'website',
    },
  };
}

function formatRelative(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.max(1, Math.round((Date.now() - then) / 60_000));
  if (diffMin < 60) {
    return locale === 'zh-Hant' ? `${diffMin} 分鐘前` : `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  }
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) {
    return locale === 'zh-Hant' ? `${diffHr} 小時前` : `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  }
  const diffDay = Math.round(diffHr / 24);
  return locale === 'zh-Hant' ? `${diffDay} 日前` : `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

export default async function RecipientEnvelopePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { token } = await params;
  const envelope = await getEnvelopeByToken(token);
  if (!envelope) notFound();

  const t = await getTranslations('Recipient');
  // Date formatting is always English here — the UI locale comes from
  // NextIntlClientProvider in the layout.
  const dateLocale = envelope.senderName.length > 0 ? 'en' : 'en';
  const sentRelative = formatRelative(envelope.sentAtIso, dateLocale);

  return (
    <main className="lb-recipient-page">
      <article className="lb-recipient" aria-labelledby="lb-recipient-heading">
        <div className="lb-envelope" aria-hidden="true">💌</div>
        <h1 id="lb-recipient-heading">
          {t('heading', { name: envelope.senderName })}
        </h1>
        <p className="from">
          <b>{envelope.senderName}</b>
          {' · '}
          <b>{sentRelative}</b>
        </p>

        {envelope.coverText && (
          <blockquote className="lb-recipient__cover">{envelope.coverText}</blockquote>
        )}

        <div className="lb-cta-row">
          <a href={`/g/${encodeURIComponent(token)}/open`} className="lb-cta-primary">
            {t('openCta')} 🎁
          </a>
          {/*
            OOP-6718 — the second CTA used to be "Save for later" with a
            dead `href="#"`. There is no save-for-later feature to point
            it at (it would need a persistence table, and the DDL path
            from this host is closed), so a link that promises a feature
            and does nothing is worse than no link. It is replaced by
            the one action that actually works from here: "Make one
            too", which walks the recipient into the creator funnel.
          */}
          <Link href="/create" className="lb-makeone">
            {t('makeOneToo')}
          </Link>
        </div>

        <footer className="lb-recipient__foot">
          <Link href="/">{BRAND.NAME}</Link>
          {' · 為香港而設 · '}
          {/*
            OOP-6718 — "Report" was the other dead `href="#"` on this
            page. A recipient who receives something abusive has to be
            able to reach someone, so the link is kept — it just points
            somewhere real. `mailto:` is the convention the support page
            already uses (no contact form, no captcha), and the gift
            link goes in the subject so the report is actionable.
          */}
          <a
            href={`mailto:bugs@lovorithm.app?subject=${encodeURIComponent(
              `Report gift: ${BRAND.PRODUCTION_URL}/g/${encodeURIComponent(token)}`,
            )}`}
          >
            {t('reportLabel') ?? 'Report'}
          </a>
        </footer>
      </article>
    </main>
  );
}
