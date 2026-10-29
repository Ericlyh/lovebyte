import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zhHant from '@/messages/zh-Hant.json';
import { ROUTE_SCOPES, ROOT_SCOPES, pickScopes, routeScopes } from './scopes';
import { scanDirectoryScopes, scanRouteScopes } from './scan-scopes';
import path from 'node:path';

/**
 * OOP-6726 — the message catalogue is sliced by route, so two things have
 * to hold for every route:
 *
 *   1. The route ships every scope it uses. A namespace that is missing
 *      from the provider does not crash — next-intl renders the raw key
 *      instead, which is exactly the failure mode this issue is about.
 *   2. The route ships nothing it does not use, which is the whole point
 *      of the exercise.
 *
 * The scan in `scan-scopes.ts` reads the source and works out what each
 * route actually asks for; `ROUTE_SCOPES` is what the provider is built
 * from. These tests hold the two together.
 */

const LOCALE_DIR = path.resolve(process.cwd(), 'src/app/[locale]');

/** Every leaf key path in a message bundle, e.g. `Landing.hero.tag`. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return [prefix];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, child]) =>
        keyPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

/** The value at a dotted path, or `undefined` when the path is absent. */
function atPath(bundle: unknown, dotted: string): unknown {
  let node: unknown = bundle;
  for (const segment of dotted.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Does `registry` supply what `scope` asks for? A namespace covers
 * everything below it, so `Common` supplies `Common.error`.
 */
function supplies(registry: readonly string[], scope: string): boolean {
  return registry.some(
    (entry) => entry === scope || scope.startsWith(`${entry}.`),
  );
}

/**
 * Is `registryScope` actually needed? A scope nobody asks for is dead
 * weight in the payload — the thing this issue set out to remove.
 */
function isNeeded(
  registryScope: string,
  scanned: readonly string[],
): boolean {
  return scanned.some(
    (entry) =>
      entry === registryScope || entry.startsWith(`${registryScope}.`),
  );
}

describe('message scopes (OOP-6726)', () => {
  const scanned = scanRouteScopes();

  it('registers a scope list for every route that serves a page', () => {
    const missing = Object.keys(scanned).filter(
      (route) => !(route in ROUTE_SCOPES),
    );
    expect(missing).toEqual([]);
  });

  it('registers no scope list for a route that does not exist', () => {
    const stale = Object.keys(ROUTE_SCOPES).filter(
      (route) => !(route in scanned),
    );
    expect(stale).toEqual([]);
  });

  it('ships every scope each route uses', () => {
    const uncovered: string[] = [];

    for (const [route, used] of Object.entries(scanned)) {
      for (const scope of used) {
        if (!supplies(ROUTE_SCOPES[route], scope)) {
          uncovered.push(`${route} uses "${scope}" but does not ship it`);
        }
      }
    }

    expect(uncovered).toEqual([]);
  });

  it('ships no scope a route does not use', () => {
    const unused: string[] = [];

    for (const [route, registered] of Object.entries(ROUTE_SCOPES)) {
      for (const scope of registered) {
        if (!isNeeded(scope, scanned[route])) {
          unused.push(`${route} ships "${scope}" but never uses it`);
        }
      }
    }

    expect(unused).toEqual([]);
  });

  it('ships every scope the root layout uses', () => {
    const rootScopes = scanDirectoryScopes(LOCALE_DIR);
    const uncovered = rootScopes.filter(
      (scope) => !supplies(ROOT_SCOPES, scope),
    );
    expect(uncovered).toEqual([]);
  });

  it('registers a scope path that exists in every locale', () => {
    const registered = [
      ...ROOT_SCOPES,
      ...Object.values(ROUTE_SCOPES).flat(),
    ];

    const missing: string[] = [];
    for (const scope of new Set(registered)) {
      if (atPath(en, scope) === undefined) missing.push(`en: ${scope}`);
      if (atPath(zhHant, scope) === undefined) missing.push(`zh-Hant: ${scope}`);
    }

    expect(missing).toEqual([]);
  });

  it('throws for a route with no registered scopes', () => {
    expect(() => routeScopes('/nope')).toThrow(/no message scopes/);
  });
});

describe('message catalogue parity', () => {
  it('has the same keys in both locales', () => {
    const enKeys = new Set(keyPaths(en));
    const zhKeys = new Set(keyPaths(zhHant));

    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key)).sort();
    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key)).sort();

    expect({ missingInZh, missingInEn }).toEqual({
      missingInZh: [],
      missingInEn: [],
    });
  });
});

describe('pickScopes', () => {
  const bundle = {
    Landing: {
      hero: { tag: 'a' },
      nav: { signIn: 'b' },
    },
    Catalog: {
      card: { by: 'c' },
      price: { free: 'd' },
    },
  };

  it('keeps only the requested namespace', () => {
    expect(pickScopes(bundle, ['Landing'])).toEqual({
      Landing: { hero: { tag: 'a' }, nav: { signIn: 'b' } },
    });
  });

  it('keeps only the requested sub-namespace', () => {
    expect(pickScopes(bundle, ['Landing.nav'])).toEqual({
      Landing: { nav: { signIn: 'b' } },
    });
  });

  it('merges several sub-namespaces of one namespace', () => {
    expect(pickScopes(bundle, ['Catalog.card', 'Catalog.price'])).toEqual({
      Catalog: { card: { by: 'c' }, price: { free: 'd' } },
    });
  });

  it('does not lose a namespace when a sub-namespace is also asked for', () => {
    expect(pickScopes(bundle, ['Catalog.card', 'Catalog'])).toEqual({
      Catalog: { card: { by: 'c' }, price: { free: 'd' } },
    });
    expect(pickScopes(bundle, ['Catalog', 'Catalog.card'])).toEqual({
      Catalog: { card: { by: 'c' }, price: { free: 'd' } },
    });
  });

  it('drops a scope that is not in the bundle', () => {
    expect(pickScopes(bundle, ['Builder.quiz'])).toEqual({});
  });

  it('leaves the source bundle untouched', () => {
    const before = JSON.stringify(bundle);
    pickScopes(bundle, ['Landing.nav']);
    expect(JSON.stringify(bundle)).toBe(before);
  });
});
