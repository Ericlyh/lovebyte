/**
 * OOP-6726 — static scan of the app tree for the message scopes each route
 * uses.
 *
 * A "scope" is the namespace argument a component hands to
 * `useTranslations('…')` or `getTranslations('…')` — `Catalog.card`,
 * `Builder.quiz`, `Landing.waitlist`, and so on. Scopes are the unit the
 * message catalogue is sliced by: the provider for a route ships exactly
 * the scopes that route (and the components it renders) ask for, so the
 * 45 KB catalogue stops riding along on every page.
 *
 * This module answers "which scopes does route X use?" by reading the
 * source: it starts at a route's own files (page, error, loading,
 * not-found) and follows their imports through `src/`, collecting every
 * scope string it finds on the way.
 *
 * It is dev-only tooling — Node APIs, no browser. `scopes.test.ts` uses it
 * to assert that the hand-maintained registry in `scopes.ts` still covers
 * what the code actually uses, and `scripts/gen-route-scopes.mjs` uses it
 * to regenerate that registry.
 */
import fs from 'node:fs';
import path from 'node:path';

/** `src/` — the only tree the scanner follows imports into. */
const SRC = path.resolve(process.cwd(), 'src');

/** The locale segment every user-facing route lives under. */
const LOCALE_SEGMENT = path.join(SRC, 'app', '[locale]');

/**
 * `useTranslations('X')` / `getTranslations('X')` — the only two ways a
 * component names a message namespace. The quote style is not fixed, so
 * all three JS flavours are accepted.
 */
const SCOPE_CALL = /\b(?:useTranslations|getTranslations)\s*\(\s*['"`]([^'"`]+)['"`]/g;

/**
 * The registry itself is excluded from the walk: it holds the scope names
 * as data, so following it would make every scope look used everywhere.
 */
const REGISTRY_FILE = path.join(SRC, 'lib', 'i18n', 'scopes.ts');

/** `import … from '…'` and bare `import '…'`. */
const IMPORT_SPECIFIER = /(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)['"]([^'"]+)['"]/g;

/** Extensions a `@/…` or relative import can resolve to. */
const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

/** Files in a route directory that contribute scopes to that route. */
const ROUTE_FILES = [
  'page.tsx',
  'error.tsx',
  'loading.tsx',
  'not-found.tsx',
  'layout.tsx',
];

export type RouteScopes = Record<string, string[]>;

/**
 * Resolve an import specifier to a file inside `src/`, or `null` when the
 * specifier points at a package (`next`, `react`), at a non-JS asset
 * (CSS), or at something that does not exist.
 */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;

  if (specifier.startsWith('@/')) {
    base = path.join(SRC, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
    ...RESOLVE_EXTENSIONS.map((ext) => path.join(base, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Every scope string in one file, plus the files it imports.
 *
 * Imports are followed even when they are type-only: over-approximating
 * the scopes a route needs is safe (the route ships a namespace it does
 * not strictly need), while under-approximating it is not (a client
 * component would fall back to rendering its raw key).
 */
function collectFromFile(
  file: string,
  scopes: Set<string>,
  seen: Set<string>,
): void {
  if (seen.has(file) || file === REGISTRY_FILE) return;
  seen.add(file);

  const source = fs.readFileSync(file, 'utf8');

  // Comments are stripped first: this file's own prose quotes
  // `useTranslations('…')` as an example, and a doc comment must not read
  // as a namespace the code asks for.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const match of code.matchAll(SCOPE_CALL)) {
    scopes.add(match[1]);
  }

  for (const match of code.matchAll(IMPORT_SPECIFIER)) {
    const resolved = resolveImport(match[1], file);
    if (resolved) collectFromFile(resolved, scopes, seen);
  }
}

/**
 * The public URL path of a route directory, e.g. `/create/[giftId]/finish`.
 *
 * Route groups (`(landing)`) are erased — they do not appear in the URL —
 * and the `[locale]` segment is dropped because it never reaches the
 * browser either.
 */
function routeKeyFor(dir: string): string {
  const relative = path.relative(LOCALE_SEGMENT, dir);
  if (!relative) return '/';

  const segments = relative
    .split(path.sep)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')));

  return segments.length ? `/${segments.join('/')}` : '/';
}

/**
 * The scopes the files in one directory use.
 *
 * Only the directory's *own* files are scanned — a child route directory
 * provides its own message provider and therefore its own scopes, so the
 * parent's scan must not absorb them.
 */
export function scanDirectoryScopes(dir: string): string[] {
  const scopes = new Set<string>();
  const seen = new Set<string>();

  for (const name of ROUTE_FILES) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) collectFromFile(file, scopes, seen);
  }

  return [...scopes].sort();
}

/**
 * Every route directory that serves a `page.tsx`, with the scopes its own
 * files use.
 */
export function scanRouteScopes(): RouteScopes {
  const result: RouteScopes = {};

  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const hasPage = entries.some(
      (entry) => entry.isFile() && entry.name === 'page.tsx',
    );

    if (hasPage) {
      const key = routeKeyFor(dir);
      const existing = result[key] ?? [];
      result[key] = [...new Set([...existing, ...scanDirectoryScopes(dir)])].sort();
    }

    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };

  walk(LOCALE_SEGMENT);

  return result;
}
