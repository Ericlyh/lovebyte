/**
 * Composes the standalone HTML document a `code` gift renders as (OOP-5688).
 *
 * The gift is displayed inside an `<iframe sandbox="allow-scripts">` — no
 * `allow-same-origin`, so the document runs on an opaque origin and cannot
 * reach our cookies, storage, or the Lovorithm DOM. The CSP below is the
 * second layer: it stops the gift from making network requests
 * (`connect-src 'none'`), from nesting frames, from submitting forms, and
 * from rewriting its own base URL.
 *
 * `style-src`/`script-src` allow `https:` so a gift can pull React or a
 * webfont from a CDN — the scanner flags external scripts as a warning for
 * exactly that reason. `img-src`/`media-src`/`font-src` allow `https:` so
 * media hosted on our own Supabase bucket renders.
 *
 * The escaping helpers below are the subtle part. We splice the sender's
 * code into a document we build, so a naive template would let the sender
 * close our `<style>` or `<script>` element and inject markup of their own
 * choosing. The sender's HTML is inserted as-is (their own `<script>`
 * tags are intentional and stay inside the sandbox); only the two fields we
 * wrap ourselves need escaping.
 */

/**
 * CSP for the gift document.
 *
 * - `default-src 'none'` — nothing loads unless explicitly allowed.
 * - `connect-src 'none'` — no fetch/XHR/WebSocket/beacon: the gift cannot
 *   send anything out, so it cannot exfiltrate anything.
 * - `script-src 'unsafe-inline' https:` — inline scripts (the whole point
 *   of the gift) and CDN scripts.
 * - `sandbox` is deliberately NOT set here: the iframe `sandbox` attribute
 *   already applies it, and setting it twice is how you end up with a
 *   document that has no script permissions at all.
 */
export const CODE_GIFT_CSP = [
  "default-src 'none'",
  "img-src data: blob: https:",
  "media-src data: blob: https:",
  "font-src data: https:",
  "style-src 'unsafe-inline' https:",
  "script-src 'unsafe-inline' https:",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Neutralise `</` inside the CSS we wrap in a `<style>` element.
 *
 * CSS has no `<` escape, but it does have hex escapes: `\3c ` is `<`.
 * Rewriting `</` to `\3c /` keeps the CSS semantically identical while
 * making the HTML tokenizer unable to see a `</style` end tag.
 */
export function escapeCssForStyleElement(css: string): string {
  return css.replace(/<\//g, '\\3c /');
}

/**
 * Neutralise `</script` inside the JS we wrap in a `<script>` element.
 *
 * `<\/script` is the standard JavaScript-safe form: inside a string literal
 * `\/` is just `/`, so the runtime value is unchanged, and in a comment or
 * a template literal it is equally harmless.
 */
export function escapeJsForScriptElement(js: string): string {
  // The replacement keeps the original casing: `</SCRIPT>` becomes
  // `<\/SCRIPT>`, so a string literal's runtime value is unchanged.
  return js.replace(/<\/script/gi, (match) => `<\\/${match.slice(2)}`);
}

import { REACT_MOUNT_SCRIPT, REACT_UMD_URLS } from './code-react-runtime';

export type CodeGiftSource = {
  html: string;
  css: string;
  js: string;
  /** true → load React 18 and mount the gift's `App` component. */
  react?: boolean;
};

/**
 * Build the full HTML document for a code gift. Used by both the builder's
 * live preview and the recipient view so the sender sees exactly what the
 * recipient will get.
 */
export function composeCodeGiftDocument(source: CodeGiftSource): string {
  const css = escapeCssForStyleElement(source.css);
  const js = escapeJsForScriptElement(source.js);

  // React's two classic scripts have to come before the gift's own
  // script: a classic script runs in document order, so `React` is
  // defined by the time the gift's code (and the mount script) run.
  const reactScripts = source.react
    ? `<script src="${REACT_UMD_URLS.react}"></script>\n<script src="${REACT_UMD_URLS.reactDom}"></script>\n`
    : '';
  const mountScript = source.react
    ? `\n<script>${escapeJsForScriptElement(REACT_MOUNT_SCRIPT)}</script>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CODE_GIFT_CSP}">
<style>${css}</style>
</head>
<body>
${source.html}
${reactScripts}<script>${js}</script>${mountScript}
</body>
</html>`;
}
