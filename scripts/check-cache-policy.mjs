#!/usr/bin/env node
/**
 * The shared-cache policy, enforced (OOP-6757).
 *
 * Two halves, because the policy has two halves:
 *
 *   1. THE STATIC GATE (`pnpm test`, via src/lib/cache-policy.test.ts) —
 *      an explicit shared-cache directive (`s-maxage`, or `export const
 *      revalidate`, which Next serves as `s-maxage=<revalidate>`) may only
 *      appear on a route listed in `SHARED_CACHEABLE_PAGE_ROUTES`
 *      (src/lib/cache-policy.ts), and never on a per-request route.
 *
 *   2. THE LIVE PROBE (`node scripts/check-cache-policy.mjs --live`, and
 *      the readiness gate) — the properties that can only be measured
 *      against the deployed site: that the edge really does serve one
 *      shared entry to every visitor, that the entry carries nobody's
 *      analytics session id, and that a signed-in request is never
 *      answered from a shared entry.
 *
 * Run the static half directly (`node scripts/check-cache-policy.mjs`) for
 * a report.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP_DIR = join(process.cwd(), 'src', 'app');
const POLICY_FILE = join(process.cwd(), 'src', 'lib', 'cache-policy.ts');
const NEXT_CONFIG = join(process.cwd(), 'next.config.ts');
const VERCEL_CONFIG = join(process.cwd(), 'vercel.json');

/**
 * The public paths a page route is allowed to be shared-cached under.
 *
 * Read out of the policy module's source rather than imported: this file
 * runs under plain node (the vitest test imports it the same way), and the
 * module is TypeScript.
 */
export function readAllowedRoutes() {
  const source = readFileSync(POLICY_FILE, 'utf8');
  const match = source.match(/SHARED_CACHEABLE_PAGE_ROUTES[^=]*=\s*\[([^\]]*)\]/);
  if (!match) {
    throw new Error(
      `Could not read SHARED_CACHEABLE_PAGE_ROUTES from ${POLICY_FILE}.`,
    );
  }
  return [...match[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
}

/** Every file under a directory, recursively. */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * The public path of a page route, and whether it is per-request.
 *
 * `[locale]` is dropped: it is the proxy's internal rewrite, not part of
 * the public URL space (`localePrefix: 'never'`). A route group
 * `(landing)` contributes nothing to the path either. Any OTHER dynamic
 * segment (`[token]`, `[giftId]`) makes the route per-request, and a
 * per-request route can never be shared-cached.
 */
function publicPathFor(segments) {
  const parts = [];
  let dynamic = false;
  for (const segment of segments) {
    if (segment.startsWith('(') && segment.endsWith(')')) continue;
    if (segment.startsWith('[') && segment.endsWith(']')) {
      if (segment === '[locale]') continue;
      dynamic = true;
      parts.push(segment);
      continue;
    }
    parts.push(segment);
  }
  const path = '/' + parts.join('/');
  return { path: path === '/' ? '/' : path.replace(/\/$/, ''), dynamic };
}

/**
 * Every route in the app tree, with its public path.
 *
 * `api` routes are marked so the caller can exempt them.
 */
export function routeTable() {
  const routes = [];
  for (const file of walk(APP_DIR)) {
    const rel = relative(APP_DIR, file).split(/[\\/]/);
    const name = rel.pop();
    if (name !== 'page.tsx' && name !== 'route.ts') continue;
    const segments = rel;
    const isApi = segments[0] === 'api';
    const { path, dynamic } = publicPathFor(segments);
    routes.push({ file, name, segments, path, dynamic, isApi });
  }
  return routes;
}

/** The `s-maxage` directives in a source file, with their line numbers. */
function sMaxageLines(source) {
  const lines = source.split('\n');
  const hits = [];
  lines.forEach((line, index) => {
    if (/s-maxage/i.test(line)) hits.push(index + 1);
  });
  return hits;
}

/**
 * The `source` pattern a config header rule applies to, if the rule has
 * one that can be read as a literal path.
 *
 * A pattern with regex metacharacters (`(`, `)`, `*`, `?`, `[`, …) covers
 * more than one path, so it is treated as broad: it can never be allowed,
 * because it would cover the per-request routes too.
 */
function literalSource(source) {
  const value = String(source ?? '').trim();
  if (!value.startsWith('/')) return null;
  if (/[()[\]{}*+?^$|\\]/.test(value)) return null;
  return value;
}

/**
 * Every violation of the shared-cache policy.
 */
export function findCachePolicyViolations({ routes } = {}) {
  const allowed = routes ?? readAllowedRoutes();
  const violations = [];
  const table = routeTable();

  const push = (file, line, message) => {
    violations.push({ file: relative(process.cwd(), file), line, message });
  };

  // ── 1. a directive on a page route ──────────────────────────────────
  for (const route of table) {
    if (route.isApi) continue; // the proxy never runs on /api
    const source = readFileSync(route.file, 'utf8');

    const hasRevalidate = /export\s+const\s+revalidate\s*=/.test(source);
    const sMaxage = sMaxageLines(source);
    if (!hasRevalidate && sMaxage.length === 0) continue;

    const what = hasRevalidate
      ? '`export const revalidate` (Next serves it as `s-maxage=<revalidate>`)'
      : 'an `s-maxage` header';

    if (route.dynamic) {
      push(
        route.file,
        hasRevalidate ? 1 : sMaxage[0],
        `A per-request route (${route.path}) carries ${what}. Its body is rendered for one visitor, so a shared cache would replay that visitor's HTML — and their Set-Cookie — to the next visitor.`,
      );
      continue;
    }

    if (!allowed.includes(route.path)) {
      push(
        route.file,
        hasRevalidate ? 1 : sMaxage[0],
        `The page route ${route.path} carries ${what}, but it is not in SHARED_CACHEABLE_PAGE_ROUTES. Only a route listed there may be cached by the edge; list it in src/lib/cache-policy.ts (with the reason it is safe) or drop the directive.`,
      );
    }
  }

  // ── 2. a directive in a config file ────────────────────────────────
  for (const file of [NEXT_CONFIG, VERCEL_CONFIG]) {
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hits = sMaxageLines(source);
    if (hits.length === 0) continue;

    const lines = source.split('\n');
    for (const line of hits) {
      // The `source` of the rule this line belongs to, if it is readable.
      let sourcePattern = null;
      for (let back = line - 1; back >= 0 && back > line - 12; back--) {
        const match = lines[back].match(/source:\s*['"`]([^'"`]+)['"`]/);
        if (match) {
          sourcePattern = match[1];
          break;
        }
      }
      const literal = literalSource(sourcePattern);
      const ok = literal !== null && allowed.includes(literal);
      if (!ok) {
        push(
          file,
          line,
          `A Cache-Control directive with s-maxage is set for ${
            sourcePattern ? `"${sourcePattern}"` : 'an unnamed set of paths'
          }. Only a route listed in SHARED_CACHEABLE_PAGE_ROUTES may be cached by the edge, and a source pattern that covers more than one path can never be, because it would cover the per-request routes too.`,
        );
      }
    }
  }

  // ── 3. a listed route that no longer exists ─────────────────────────
  for (const path of allowed) {
    const route = table.find((r) => r.name === 'page.tsx' && r.path === path);
    if (!route) {
      violations.push({
        file: relative(process.cwd(), POLICY_FILE),
        line: 0,
        message: `SHARED_CACHEABLE_PAGE_ROUTES lists ${path}, but no page route resolves to that path.`,
      });
    }
  }

  return violations;
}

/**
 * The live probe — the properties that only the deployed site can show.
 *
 * Three checks, one per acceptance criterion of OOP-6757:
 *
 *   1. an anonymous visitor's first and second request land on the SAME
 *      shared entry (`x-vercel-cache: HIT`, the same `etag`) — the
 *      performance win survives;
 *   2. the shared entry carries nobody's analytics session id — two
 *      visitors get two different session ids, and a visitor who already
 *      has one gets no `Set-Cookie` at all;
 *   3. a request that carries a session cookie is not answered from a
 *      shared entry, and a per-request route is served `private,
 *      no-store`.
 *
 * Returns `{ ok, checks }` — `checks` is what the readiness gate reports.
 */
export async function probeSharedCache(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const get = async (path, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      headers,
      redirect: 'manual',
      cache: 'no-store',
    });
    const body = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      body,
      etag: res.headers.get('etag'),
      age: res.headers.get('age'),
      vercelCache: res.headers.get('x-vercel-cache'),
      cacheControl: res.headers.get('cache-control'),
      sessionCookie: res.headers
        .getSetCookie()
        .find((c) => c.startsWith('lb-sid='))
        ?.split('=')[1]
        ?.split(';')[0],
    };
  };

  try {
    // 1 + 2. The same shared entry, and a session id nobody else gets.
    const first = await get('/');
    const second = await get('/');

    add(
      'shared-entry',
      Boolean(first.etag) && first.etag === second.etag,
      `etag ${first.etag ?? 'none'} / ${second.etag ?? 'none'}, x-vercel-cache ${first.vercelCache ?? '-'} then ${second.vercelCache ?? '-'}`,
    );
    add(
      'cache-hit',
      second.vercelCache === 'HIT' || second.vercelCache === 'PRERENDER',
      `second request x-vercel-cache: ${second.vercelCache ?? 'none'}`,
    );
    add(
      'session-not-replayed',
      Boolean(first.sessionCookie) &&
        Boolean(second.sessionCookie) &&
        first.sessionCookie !== second.sessionCookie,
      first.sessionCookie && second.sessionCookie
        ? `two visitors got ${first.sessionCookie} and ${second.sessionCookie}`
        : 'no session cookie on one of the responses',
    );

    // 2b. A visitor who already has a session gets no Set-Cookie — the
    // stored entry carries none.
    const withCookie = await get('/', {
      cookie: `lb-sid=${first.sessionCookie ?? '00000000-0000-4000-8000-000000000000'}`,
    });
    add(
      'entry-carries-no-cookie',
      !withCookie.sessionCookie,
      withCookie.sessionCookie
        ? `the entry replayed a session cookie (${withCookie.sessionCookie})`
        : 'no Set-Cookie on the response',
    );

    // 3. A signed-in request is not answered from a shared entry, and the
    // route it lands on does not depend on who asked.
    const signedIn = await get('/', {
      cookie: 'sb-xsfbfqzmvjfxppvoxbze-auth-token=probe.probe',
    });
    add(
      'signed-in-not-shared',
      (signedIn.cacheControl ?? '').includes('private') &&
        (signedIn.cacheControl ?? '').includes('no-store'),
      `cache-control: ${signedIn.cacheControl ?? 'none'}`,
    );
    add(
      'route-is-requester-independent',
      signedIn.body === first.body,
      signedIn.body === first.body
        ? 'the body is identical for a signed-in and an anonymous requester'
        : 'the body differs between a signed-in and an anonymous requester — this route may not be shared-cached',
    );

    // 3b. A per-request route is private to its requester. `age: 0` is
    // sent on a response that was never cached, so the cache STATE is
    // what says whether the edge stored it.
    const personal = await get('/settings');
    add(
      'per-request-route-private',
      (personal.cacheControl ?? '').includes('private') &&
        (personal.cacheControl ?? '').includes('no-store') &&
        personal.vercelCache !== 'HIT' &&
        personal.vercelCache !== 'STALE',
      `cache-control: ${personal.cacheControl ?? 'none'}, x-vercel-cache: ${personal.vercelCache ?? 'none'}`,
    );
  } catch (err) {
    add('probe-ran', false, `the probe could not run: ${err.message}`);
  }

  return { ok: checks.every((check) => check.ok), checks };
}

/** Print the violations and exit non-zero if there are any. */
export async function main() {
  if (process.argv.includes('--live')) {
    const base =
      process.argv[process.argv.indexOf('--live') + 1] ??
      process.env.AUDIT_BASE ??
      'https://lovorithm.vercel.app';
    const result = await probeSharedCache(base);
    for (const check of result.checks) {
      console.log(
        `  ${check.ok ? 'ok  ' : 'FAIL'} ${check.name}: ${check.detail}`,
      );
    }
    console.log(
      result.ok
        ? `\ncache policy: OK — ${base} serves one shared entry, with no session id in it.`
        : `\ncache policy: FAIL — ${base} broke the shared-cache policy.`,
    );
    return result.ok ? 0 : 1;
  }

  const violations = findCachePolicyViolations();
  if (violations.length === 0) {
    console.log(
      'cache policy: OK — every shared-cache directive is on a listed route.',
    );
    return 0;
  }
  console.error(`cache policy: ${violations.length} violation(s)\n`);
  for (const violation of violations) {
    console.error(
      `  ${violation.file}${violation.line ? `:${violation.line}` : ''}\n    ${violation.message}\n`,
    );
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
