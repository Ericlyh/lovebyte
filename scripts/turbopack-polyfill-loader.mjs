/**
 * Turbopack loader: replaces Next.js's blanket browser polyfills (OOP-6725).
 *
 * Next installs nine feature-detected shims with its client entry
 * (`next/dist/build/polyfills/polyfill-module.js`): `trimStart`,
 * `trimEnd`, `Symbol.prototype.description`, `Array.prototype.flat`,
 * `flatMap`, `Promise.prototype.finally`, `Object.fromEntries`,
 * `Array.prototype.at`, `Object.hasOwn` and `URL.canParse`.
 *
 * This app compiles for the "baseline widely available" target (chrome
 * 111, edge 111, firefox 111, safari 16.4 — see `browserslist` in
 * package.json), and every browser at or above that target already has
 * eight of the nine natively. `URL.canParse` is the exception: it only
 * landed in safari 17, chrome 120 and firefox 115, so a safari 16.4
 * visitor still needs it. That is the only shim installed here.
 *
 * The loader exists because the payoff is not the ~1.3 KiB the shims
 * weigh. Lighthouse's `legacy-javascript` audit pattern-matches the
 * shims' *signatures* in the bundle and estimates what the equivalent
 * core-js polyfill graph would weigh — so it reported ~14 KiB of "legacy
 * JavaScript" against a page whose polyfill code was 1.4 KiB. Replacing
 * the module with one that carries none of those signatures takes that
 * audit to zero.
 *
 * `next.config.ts` points Turbopack at this file with `turbopack.rules`.
 * The `resolveAlias` route does not work: Next's client entry requires
 * the module by the relative path `../build/polyfills/polyfill-module`,
 * and Turbopack matches aliases against the request as written.
 *
 * `src/lib/polyfills/client.test.ts` guards what this file returns.
 */

/**
 * The replacement module source.
 *
 * It is a side-effect-only script because the module it replaces is
 * `require()`d for its side effects. It must stay valid in a CommonJS
 * context — no `import` / `export` statements.
 */
const POLYFILL_SOURCE = `
'use strict';

/**
 * The browser polyfills this site needs (OOP-6725).
 *
 * Next.js ships nine feature-detected shims with its client entry.
 * Eight of them are redundant at this site's browser floor
 * (chrome/edge/firefox 111, safari 16.4 — see "browserslist" in
 * package.json); every browser at or above that floor has them
 * natively. "URL.canParse" is the exception: it only landed in
 * safari 17, chrome 120 and firefox 115, so a safari 16.4 visitor
 * still needs it.
 *
 * If "browserslist" is ever lowered below safari 16.4 / chrome 93,
 * this file has to grow the shims back.
 */
'canParse' in URL || (URL.canParse = function canParse(url, base) {
  try {
    new URL(url, base);
    return true;
  } catch {
    return false;
  }
});
`;

/**
 * @returns {string} the module source that replaces Next's polyfill module
 */
export default function turbopackPolyfillLoader() {
  return POLYFILL_SOURCE;
}
