import { getTranslations } from 'next-intl/server';
import { composeCodeGiftDocument } from '@/lib/gifts/code-render';
import type { CodeRecipientPayload } from '@/features/code/schemas';

/**
 * CodeGiftView — recipient render for a `code` gift (OOP-5688).
 *
 * The gift is a small web page the sender wrote. It runs inside an
 * `<iframe>` with `sandbox="allow-scripts"`:
 *
 *   - no `allow-same-origin` → the frame gets an opaque origin, so the
 *     gift cannot read Lovorithm's cookies or storage, and cannot touch
 *     this page's DOM;
 *   - no `allow-popups`, `allow-forms`, `allow-top-navigation` → the gift
 *     cannot open windows, submit forms, or navigate the tab away;
 *   - `allow-scripts` → the gift's JavaScript does run, which is the point.
 *
 * The document itself carries a strict CSP (see `code-render.ts`) that
 * additionally blocks network requests, nested frames and `<base>` tags.
 *
 * The sender's code is rendered inside the frame, never in this document,
 * so a bug in their code cannot break the Lovorithm page around it.
 */
export async function CodeGiftView({
  payload,
  senderName,
}: {
  payload: CodeRecipientPayload;
  senderName: string;
}) {
  const t = await getTranslations('Open');
  const document = composeCodeGiftDocument(payload);

  return (
    <main className="lb-code-page">
      <header className="lb-code-page__head">
        <span className="lb-tag">{t('codeTag')}</span>
        <p className="lb-letter__from">{t('fromLine', { name: senderName })}</p>
      </header>

      <iframe
        className="lb-code-gift__frame"
        title={t('codeFrameTitle')}
        sandbox="allow-scripts"
        srcDoc={document}
      />

      <footer className="lb-code-page__foot">{t('codeFoot')}</footer>
    </main>
  );
}
