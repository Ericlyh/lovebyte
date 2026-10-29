'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ReplyForm } from '@/components/catalog/ReplyForm';

/**
 * RecipientWriteBack — the outbound half of the gift loop (OOP-6718).
 *
 * A recipient at `/g/[token]` is at the highest-intent moment in the
 * product, and until this existed the page offered them exactly one
 * live action: "Open your gift". Everything after it went nowhere.
 *
 * This renders the two things a recipient needs next:
 *
 *   1. "Make one too →" — a link into the creator funnel (`/create`).
 *      The recipient surface had NO outbound link into the creator
 *      funnel at all before this: the only links out were the site
 *      root and a dead `href="#"`.
 *   2. A write-back composer — a reply to the gift's creator, which
 *      lands in `gift_replies` and notifies the creator
 *      (`notifyGiftCreatorOfReply`).
 *
 * The composer reuses the listing page's `ReplyForm` rather than
 * growing a second one: the three render modes (loading / anon /
 * authed), the char counter and the error handling are already right,
 * and only the copy and the sign-in destination differ. Those are
 * props.
 *
 * `giftId` is null for the seeded mock envelopes (`/g/demo`), which
 * have no database row — `gift_replies` is keyed by gift, so there is
 * nothing to reply to. The "Make one too" link still renders: it is
 * the one action that works everywhere.
 */

type Props = {
  /** The gift to reply to. Null when the share has no database row. */
  giftId: string | null;
  /** Display name of the person who sent the gift. */
  senderName: string;
  /** Where a visitor returns to after signing in. */
  nextPath: string;
};

export function RecipientWriteBack({ giftId, senderName, nextPath }: Props) {
  const t = useTranslations('Recipient');

  return (
    <section className="lb-writeback" aria-labelledby="lb-writeback-heading">
      <h2 id="lb-writeback-heading" className="lb-writeback__heading">
        {t('writeBack.heading', { name: senderName })}
      </h2>

      {giftId ? (
        <ReplyForm
          giftId={giftId}
          nextPath={nextPath}
          composerLabel={t('writeBack.composerLabel')}
          placeholder={t('writeBack.placeholder')}
          submitLabel={t('writeBack.submit')}
          submittingLabel={t('writeBack.submitting')}
          signInPrompt={t('writeBack.signInPrompt', { name: senderName })}
          signInCta={t('writeBack.signInCta')}
        />
      ) : null}

      <Link href="/create" className="lb-makeone">
        {t('makeOneToo')}
      </Link>
    </section>
  );
}
