import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { getEnvelopeByToken } from '@/lib/gifts/fetch';

/**
 * /api/og/[shareToken] — Open Graph image generator (Phase 3).
 *
 * Returns a 1200×630 image suitable for WhatsApp / iMessage / Twitter
 * link unfurls. The envelope text (sender name + cover quote) is
 * overlaid on the warm-romantic palette so unfurls look like a
 * LoveByte envelope even before the recipient clicks through.
 *
 * Hard constraint from OOP-4211: `next/og` for OG cards.
 * `next/og`'s ImageResponse requires Edge Runtime.
 */

export const runtime = 'edge';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ shareToken: string }> },
) {
  const { shareToken } = await context.params;
  const envelope = await getEnvelopeByToken(shareToken);

  const senderName = envelope?.senderName ?? 'Someone special';
  const quote =
    envelope?.coverText ??
    'sent you a one-of-a-kind gift.';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'linear-gradient(180deg, #ffe8e7 0%, #fff1d6 60%, #fffaf7 100%)',
          fontFamily: 'serif',
          padding: 80,
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 140,
            height: 140,
            borderRadius: 32,
            background: '#fc6b6b',
            fontSize: 96,
            marginBottom: 48,
            boxShadow: '0 12px 40px rgba(204, 88, 88, 0.35)',
          }}
        >
          💌
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 56,
            color: '#fc6b6b',
            fontWeight: 700,
            marginBottom: 24,
            textAlign: 'center',
            maxWidth: 1000,
            lineHeight: 1.15,
          }}
        >
          {senderName} sent you something.
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            color: '#6b4a4a',
            fontStyle: 'italic',
            textAlign: 'center',
            maxWidth: 900,
            lineHeight: 1.4,
          }}
        >
          “{quote}”
        </div>
        <div
          style={{
            display: 'flex',
            position: 'absolute',
            bottom: 56,
            fontSize: 24,
            color: '#cc5858',
            letterSpacing: 4,
            fontWeight: 700,
          }}
        >
          LOVEBYTE
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
