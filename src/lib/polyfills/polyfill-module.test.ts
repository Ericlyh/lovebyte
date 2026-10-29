import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// A build script, not part of the app — it has no type declarations.
import polyfillLoader from '../../../scripts/turbopack-polyfill-loader.mjs';

/**
 * OOP-6725 — the guard on the browser polyfill module.
 *
 * Next.js installs nine feature-detected shims with its client entry.
 * Eight of them are redundant at this site's browser floor (chrome /
 * edge / firefox 111, safari 16.4 — see `browserslist` in package.json)
 * and one (`URL.canParse`) is still needed, because it only landed in
 * safari 17, chrome 120 and firefox 115.
 *
 * These two tests pin that down. The first says the shim we DO ship is
 * the right one; the second says the eight we dropped stay dropped —
 * either of them coming back would put ~14 KiB of "legacy JavaScript"
 * back into Lighthouse's `legacy-javascript` audit.
 */

/** The eight shims a browser at our floor has natively. */
const REDUNDANT_SHIMS = [
  'trimStart',
  'trimEnd',
  'Symbol.prototype',
  'Array.prototype.flat',
  'flatMap',
  'Promise.prototype.finally',
  'Object.fromEntries',
  'Array.prototype.at',
  'Object.hasOwn',
];

describe('the browser polyfill module (OOP-6725)', () => {
  it('installs URL.canParse, the one shim safari 16.4 still needs', () => {
    const source = polyfillLoader();

    expect(source).toContain('URL.canParse');
    // It has to be feature-detected, not assigned unconditionally:
    // a browser that already has it must keep the native one.
    expect(source).toMatch(/'canParse'\s+in\s+URL/);
  });

  it('does not ship the eight shims our browser floor has natively', () => {
    const source = polyfillLoader();

    for (const shim of REDUNDANT_SHIMS) {
      expect(source).not.toContain(shim);
    }
  });

  it('stays a side-effect-only script, because it replaces a CommonJS module', () => {
    const source = polyfillLoader();

    // Next requires its polyfill module for its side effects, so the
    // replacement must not turn the module into an ES module.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s/m);
  });

  it('is still pointed at the right file in next.config.ts', () => {
    // The loader replaces a file inside Next, by path. If a Next
    // upgrade moves that file, the rule stops matching and the shims
    // come back silently — this is the test that notices.
    expect(
      existsSync(
        resolve(
          process.cwd(),
          'node_modules/next/dist/build/polyfills/polyfill-module.js',
        ),
      ),
    ).toBe(true);
  });
});
