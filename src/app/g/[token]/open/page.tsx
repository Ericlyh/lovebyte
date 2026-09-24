import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { getEnvelopeByToken } from '@/lib/gifts/fetch';
import {
  AnimatedLetterPayloadSchema,
  MemoryCardsPayloadSchema,
} from '@/lib/gifts/schemas';
import { MemoryCardsGame } from '@/features/memory-cards/recipient/MemoryCardsGame';

/**
 * /g/[shareToken]/open — in-experience view (Phase 3 envelope + Phase 4
 * memory_cards game, OOP-4211 / OOP-4219).
 *
 * Edge runtime per OOP-4211 hard constraint. Dispatches on gift type:
 *   • animated_letter   → scroll-reveal letter (Phase 3)
 *   • memory_cards      → flip-and-match game (Phase 4)
 *   • dragdrop_puzzle / quiz / multimedia_collage → placeholder
 *
 * The Zod schema for the type-specific payload is the type-narrow
 * boundary (architecture §6) — anything that fails safeParse falls back
 * to the placeholder rather than rendering a broken game.
 */

export const runtime = 'edge';

type Props = {
  params: Promise<{ token: string }>;
};

export default async function GiftOpenPage({ params }: Props) {
  const { token } = await params;
  const envelope = await getEnvelopeByToken(token);
  if (!envelope) notFound();

  if (envelope.giftType === 'memory_cards') {
    const parsed = MemoryCardsPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      return <GiftNotYetShipped envelope={envelope} reason="schema-mismatch" />;
    }
    return <MemoryCardsGame payload={parsed.data} senderName={envelope.senderName} />;
  }

  if (envelope.giftType !== 'animated_letter') {
    return <GiftNotYetShipped envelope={envelope} />;
  }

  // Narrow the payload via the Zod schema before rendering
  // (architecture §6: validate at the type-narrow boundary).
  const parsed = AnimatedLetterPayloadSchema.safeParse(envelope.payload);
  if (!parsed.success) {
    return <GiftNotYetShipped envelope={envelope} reason="schema-mismatch" />;
  }
  return <AnimatedLetter letter={parsed.data} senderName={envelope.senderName} />;
}

async function AnimatedLetter({
  letter,
  senderName,
}: {
  letter: ReturnType<typeof AnimatedLetterPayloadSchema.parse>;
  senderName: string;
}) {
  const t = await getTranslations('Open');
  const paragraphs = letter.markdown.split(/\n{2,}/);

  return (
    <main className="lb-letter-page">
      <article className={`lb-letter lb-letter--paper-${letter.paper}`}>
        <header className="lb-letter__head">
          <span className="lb-tag">{t('letterTag')}</span>
          <p className="lb-letter__from">{t('fromLine', { name: senderName })}</p>
        </header>
        <div className="lb-letter__body">
          {paragraphs.map((p, i) => (
            <p key={i} className="lb-letter__paragraph">
              {p}
            </p>
          ))}
        </div>
        {letter.inline_media.length > 0 && (
          <ul className="lb-inline-media">
            {letter.inline_media.map((m, i) => (
              <li key={i} className={`lb-inline-media__item lb-inline-media--${m.type}`}>
                <span aria-hidden="true">
                  {m.type === 'photo' ? '📷' : m.type === 'voice' ? '🎙️' : m.type === 'music' ? '🎵' : '✨'}
                </span>
                {m.caption ?? m.url}
              </li>
            ))}
          </ul>
        )}
        <footer className="lb-letter__foot">
          {t('letterFoot')}
        </footer>
      </article>
    </main>
  );
}

async function GiftNotYetShipped({
  envelope,
  reason,
}: {
  envelope: { giftType: string; senderName: string };
  reason?: string;
}) {
  const t = await getTranslations('Open');
  return (
    <main className="lb-letter-page">
      <article className="lb-letter lb-letter--paper-cream">
        <header className="lb-letter__head">
          <span className="lb-tag">{envelope.giftType}</span>
          <p className="lb-letter__from">{t('fromLine', { name: envelope.senderName })}</p>
        </header>
        <div className="lb-letter__body">
          <p className="lb-letter__paragraph">{t('notShippedYet')}</p>
          {reason === 'schema-mismatch' && (
            <p className="lb-letter__paragraph">{t('schemaMismatch')}</p>
          )}
        </div>
      </article>
    </main>
  );
}
