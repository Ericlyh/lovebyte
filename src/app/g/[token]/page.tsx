import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEnvelopeByToken } from '@/lib/gifts/fetch';

/**
 * /g/[shareToken] — recipient envelope view (Phase 3, architecture §2).
 *
 * Most-shared surface in the app. Runs on Edge Runtime per
 * OOP-4211 hard constraint. Renders the envelope from
 * design/03-mockups/recipient-view.html.
 *
 * Data: src/lib/gifts/fetch.ts — falls back to mock seed until the
 * Supabase Cloud project is provisioned (OOP-4211 blocker #2).
 */

export const runtime = 'edge';

type Props = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const envelope = await getEnvelopeByToken(token);
  const ogUrl = `/api/og/${encodeURIComponent(token)}`;
  if (!envelope) {
    return {
      title: 'A gift for you — LoveByte',
      openGraph: { images: [ogUrl] },
    };
  }
  return {
    title: `${envelope.senderName} sent you something — LoveByte`,
    description:
      envelope.coverText ??
      `${envelope.senderName} sent you a one-of-a-kind gift on LoveByte.`,
    openGraph: {
      title: `${envelope.senderName} sent you something`,
      description:
        envelope.coverText ?? 'Open your gift on LoveByte.',
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
  const { token } = await params;
  const envelope = await getEnvelopeByToken(token);
  if (!envelope) notFound();

  const t = await getTranslations('Recipient');
  const locale = envelope.senderName.length > 0 ? 'en' : 'en'; // i18n handled by NextIntlClientProvider from layout
  const sentRelative = formatRelative(envelope.sentAtIso, locale);

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
          <a href="#" className="lb-recipient__saveforlater">
            {t('saveForLater')}
          </a>
        </div>

        <footer className="lb-recipient__foot">
          <Link href="/">LoveByte</Link>
          {' · 為香港而設 · '}
          <a href="#">{t('reportLabel') ?? 'Report'}</a>
        </footer>
      </article>
    </main>
  );
}
