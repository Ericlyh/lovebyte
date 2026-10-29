import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GiftTypeSchema } from './schemas';
import {
  DEFAULT_GIFT_TYPE,
  GIFT_BUILDER_ROUTES,
  GIFT_TYPES,
} from './types';

/**
 * The picker and the builder routes must not drift apart (OOP-6720).
 *
 * The bug this pins: `animated_letter` was the FIRST entry in the
 * create dropdown and the DEFAULT value, and it had no builder route
 * at all. Picking it produced a draft with an empty payload, which the
 * publish action then refused — so the default option in the picker was
 * the one option that could never be completed.
 *
 * Three assertions, in increasing strength:
 *   1. every gift type has a builder route (the map is total);
 *   2. the dropdown default has a builder route;
 *   3. every route points at a builder page that EXISTS on disk —
 *      a map entry pointing at a 404 is still a dead end.
 */
describe('gift types ↔ builder routes', () => {
  const appDir = path.join(process.cwd(), 'src', 'app', '[locale]');

  it('gives every gift type a builder route', () => {
    for (const type of GiftTypeSchema.options) {
      expect(GIFT_BUILDER_ROUTES[type], `no builder route for ${type}`).toBeTruthy();
    }
  });

  it('gives every picker entry a builder route', () => {
    for (const { value, label } of GIFT_TYPES) {
      expect(GIFT_BUILDER_ROUTES[value], `no builder route for "${label}"`).toBeTruthy();
    }
  });

  it('points the dropdown default at a builder route', () => {
    expect(GIFT_BUILDER_ROUTES[DEFAULT_GIFT_TYPE]).toBeTruthy();
  });

  it('backs every builder route with a page that exists', () => {
    for (const [type, route] of Object.entries(GIFT_BUILDER_ROUTES)) {
      const slug = route.replace(/^\/create\//, '');
      const page = path.join(appDir, 'create', slug, 'page.tsx');
      expect(existsSync(page), `${type} → ${route} has no page at ${page}`).toBe(true);
    }
  });
});
