'use client';

/**
 * The sandboxed frame a code gift renders in (OOP-7451).
 *
 * Split out of `CodeGiftView` so the catalogue preview can show a code
 * gift too: the preview is a client component (it is opened from the
 * client-side browse grid) and `CodeGiftView` is a server component.
 * The frame itself is pure markup with no server dependency, so both
 * can render it.
 *
 * The sandbox is the security boundary and it does not change here:
 *
 *   - `allow-scripts` and NOT `allow-same-origin` → the frame gets an
 *     opaque origin, so the gift cannot read Lovorithm's cookies or
 *     storage, and cannot touch the page around it;
 *   - no `allow-popups`, `allow-forms`, `allow-top-navigation` → the
 *     gift cannot open windows, submit forms, or navigate the tab away.
 *
 * The document itself carries a strict CSP on top of this (see
 * `code-render.ts`), which blocks network requests, nested frames and
 * `<base>` tags.
 */
export function CodeGiftFrame({
  document,
  title,
}: {
  /** The composed HTML document (see `composeCodeGiftDocument`). */
  document: string;
  /** Accessible name for the frame. */
  title: string;
}) {
  return (
    <iframe
      className="lb-code-gift__frame"
      title={title}
      sandbox="allow-scripts"
      srcDoc={document}
    />
  );
}
