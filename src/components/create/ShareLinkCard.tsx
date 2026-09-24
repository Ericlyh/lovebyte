'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * ShareLinkCard — the "your share link is ready" card on
 * /create/[giftId]/finish?share=<token>.
 *
 * Used by Phase 4 builders (memory_cards, …) that auto-create the share
 * row so the recipient can open immediately. The sender copies the link
 * here, then optionally publishes to the marketplace below.
 *
 * Client-side because we need `window.location.origin` to build the
 * full URL and we want a one-tap clipboard copy.
 */
export function ShareLinkCard({
  token,
  originHeader: _originHeader,
}: {
  token: string;
  /**
   * Reserved for future server-side origin resolution (e.g. reading
   * x-forwarded-host in middleware). Today window.location.origin
   * covers every deploy we ship.
   */
  originHeader?: string;
}) {
  const t = useTranslations('Create.finish.share');
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/g/${token}`
      : `/g/${token}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback: select the input so the user can ⌘C manually.
      const input = document.getElementById('share-link-input') as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <article className="lb-card lb-share-link-card">
      <h2>{t('heading')}</h2>
      <p className="lede">{t('lede')}</p>
      <div className="lb-share-link-card__row">
        <input
          id="share-link-input"
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t('linkAria')}
        />
        <button
          type="button"
          className="lb-btn lb-btn--primary"
          onClick={handleCopy}
        >
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <p className="lb-share-link-card__hint">{t('hint')}</p>
    </article>
  );
}
