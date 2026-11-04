import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The global error boundary (OOP-6737).
 *
 * Next does not let a segment's `error.tsx` catch an error thrown in that
 * segment's own `layout.tsx` — the root layout's throw escapes every
 * boundary in the tree, and Next renders its own error page ("This page
 * couldn't load. A server error occurred."): no branding, no styles, no
 * language.
 *
 * `global-error.tsx` is the boundary for that case, and it REPLACES the
 * root layout — so it has to bring its own document, its own styles and
 * its own fonts. These assertions are about that shape, because the
 * failure it guards against is invisible until it happens.
 */

const APP_DIR = join(process.cwd(), 'src', 'app');
const FILE = join(APP_DIR, 'global-error.tsx');

const source = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';

/**
 * The source with its comments stripped.
 *
 * The file quotes Next's default error text in its own documentation, so
 * an assertion about "the file does not contain it" has to look at the
 * code and not at the prose around it.
 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the global error boundary', () => {
  it('exists at the root of the app directory', () => {
    // Next resolves the custom global error at the ROOT LAYER, which is
    // the app root — `segments.length === 0` in its app loader. A
    // `global-error.tsx` inside `src/app/[locale]/` is silently ignored
    // and the built-in error page is used instead, which is what a first
    // attempt at this got wrong.
    //
    // The root LAYOUT of this app is `src/app/[locale]/layout.tsx`
    // (OOP-6710 — there is no `src/app/layout.tsx`), and Next documents
    // this shape: "you can handle errors in the root layout or template
    // using global-error.jsx, located in the root app directory, even
    // when leveraging internationalization".
    expect(existsSync(join(APP_DIR, 'layout.tsx'))).toBe(false);
    expect(existsSync(FILE)).toBe(true);
  });

  it('is a client component', () => {
    // Error boundaries must be client components: they receive the error
    // and the `reset()` callback.
    expect(source).toMatch(/^'use client';/);
  });

  it('renders its own document', () => {
    // It replaces the root layout, so it owns the <html> and the <body>.
    expect(source).toMatch(/<html/);
    expect(source).toMatch(/<body/);
  });

  it('declares a language', () => {
    // The 404 document failed axe's `html-has-lang` rule (WCAG 3.1.1)
    // for the same reason this page needs it: it renders without the
    // layout that would have declared it.
    expect(source).toMatch(/lang="[a-zA-Z-]+"/);
  });

  it('brings the styles and the fonts the layout would have loaded', () => {
    expect(source).toMatch(/import '\.\/globals\.css'/);
    expect(source).toContain('Norican');
    expect(source).toContain('Overlock');
  });

  it('renders the shared error card, not a raw error', () => {
    expect(code).toContain('PageStateError');
    expect(code).not.toMatch(/Application error/);
  });

  it('keeps its copy in step with the catalogue', () => {
    // The boundary has no intl provider (it replaced the layout that
    // provided one), so the copy is inline. It must not drift from
    // `Common.error`, or the same failure would read differently
    // depending on which boundary caught it.
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), 'src', 'messages', 'en.json'), 'utf8'),
    );
    const expected = messages.Common.error;

    expect(source).toContain(`title: '${expected.title}'`);
    expect(source).toContain(`body: '${expected.body}'`);
    expect(source).toContain(`retry: '${expected.retry}'`);
  });

  it('has a check that drives a real browser', () => {
    // The boundary renders on the CLIENT — the server sends Next's
    // `__next_error__` shell with the boundary in the flight payload — so
    // a curl cannot see the result. The check has to be a browser, and it
    // has to be reproducible, which is what the layout's diagnostic
    // trigger is for.
    const check = join(process.cwd(), 'scripts', 'check-global-error.mjs');
    expect(existsSync(check)).toBe(true);
    expect(readFileSync(check, 'utf8')).toContain('LOVEBYTE_FORCE_LAYOUT_ERROR');
  });
});
