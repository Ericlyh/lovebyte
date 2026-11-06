import type { AnimatedLetterPayload } from '@/lib/gifts/schemas';

/**
 * The animated letter's visual body (OOP-7451).
 *
 * ONE markup for the letter, used in two places:
 *
 *   1. `/g/[token]/open` — the recipient opens the gift. That render is
 *      a SERVER component: the letter is the emotional core of the
 *      product, and the recipient should read it in the first paint,
 *      not after hydration.
 *   2. The catalogue preview — a visitor browsing /browse clicks
 *      "Preview" and sees the letter before they buy. That render is a
 *      CLIENT component, because the preview is opened from a
 *      client-side grid.
 *
 * So the markup cannot live in either caller: a server component cannot
 * be imported into a client component, and a client component would
 * make the recipient wait for hydration to read the letter. It lives
 * here instead, with every string passed in — no `getTranslations`, no
 * server-only import — so both callers can use it.
 */
type Props = {
  /** The validated letter payload. */
  letter: Pick<AnimatedLetterPayload, 'markdown' | 'paper' | 'inline_media'>;
  /** The tag above the letter — "A letter", or the kind of gift. */
  tag: string;
  /** "From <sender>", already interpolated. */
  fromLine: string;
  /** The footer line under the letter. */
  foot?: string;
};

export function LetterView({ letter, tag, fromLine, foot }: Props) {
  const paragraphs = letter.markdown.split(/\n{2,}/);

  return (
    <article className={`lb-letter lb-letter--paper-${letter.paper}`}>
      <header className="lb-letter__head">
        <span className="lb-tag">{tag}</span>
        <p className="lb-letter__from">{fromLine}</p>
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
            <li key={i} className="lb-inline-media__item">
              <span aria-hidden="true">
                {m.type === 'photo' ? '📷' : m.type === 'voice' ? '🎙️' : m.type === 'music' ? '🎵' : '✨'}
              </span>
              {m.caption ?? m.url}
            </li>
          ))}
        </ul>
      )}
      {foot ? <footer className="lb-letter__foot">{foot}</footer> : null}
    </article>
  );
}
