import { describe, expect, it } from 'vitest';
import { GIFT_PAGES, getGiftPage, giftPagesOfKind } from './index';
import type { GiftPage, Localized } from './types';

/**
 * OOP-6727 — the gift guides have to be genuinely indexable, and the
 * acceptance criterion says it plainly: "A route with thin or duplicated
 * copy is worse than no route: do not mass-generate pages."
 *
 * That is a claim about content, so it needs a check. A registry makes
 * it easy to write seven pages that say the same thing in seven ways —
 * or one page seven times. These tests are what stops that.
 */

/** Every string on a page, in one locale. */
function copyOf(page: GiftPage, locale: 'en' | 'zhHant'): string[] {
  const pick = (value: Localized) => value[locale];
  const out: string[] = [
    pick(page.metaTitle),
    pick(page.metaDescription),
    pick(page.heading),
    pick(page.lede),
  ];

  for (const section of page.sections) {
    out.push(pick(section.heading), pick(section.body));
    for (const point of section.points ?? []) out.push(pick(point));
  }

  for (const entry of page.faq) {
    out.push(pick(entry.q), pick(entry.a));
  }

  return out;
}

/** The body prose of a page — the paragraphs, not the headings. */
function bodyOf(page: GiftPage, locale: 'en' | 'zhHant'): string {
  const paragraphs = page.sections.map((s) => s.body[locale]);
  const answers = page.faq.map((entry) => entry.a[locale]);
  return [...paragraphs, ...answers].join(' ');
}

/** A rough word count, good enough for "is this a page or a stub?". */
function wordCount(text: string): number {
  // Chinese has no spaces — count characters for it, words for English.
  const cjk = text.match(/[一-鿿]/g)?.length ?? 0;
  const latin = text
    .replace(/[一-鿿]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
  return cjk + latin;
}

const LOCALES = ['en', 'zhHant'] as const;

describe('the gift guide registry (OOP-6727)', () => {
  it('has at least the five guides the issue asked for', () => {
    expect(GIFT_PAGES.length).toBeGreaterThanOrEqual(5);
  });

  it('has no duplicate slugs', () => {
    const slugs = GIFT_PAGES.map((page) => page.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses slugs that are safe in a URL', () => {
    for (const page of GIFT_PAGES) {
      expect(page.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('covers all three kinds', () => {
    expect(giftPagesOfKind('format').length).toBeGreaterThan(0);
    expect(giftPagesOfKind('occasion').length).toBeGreaterThan(0);
    expect(giftPagesOfKind('audience').length).toBeGreaterThan(0);
  });

  it('finds a guide by slug and returns null for anything else', () => {
    expect(getGiftPage('memory-cards')?.slug).toBe('memory-cards');
    expect(getGiftPage('nope')).toBeNull();
  });
});

describe('every guide is a real page', () => {
  for (const page of GIFT_PAGES) {
    describe(`/${page.slug}`, () => {
      it('has a heading, a lede and at least three sections', () => {
        expect(page.sections.length).toBeGreaterThanOrEqual(3);
      });

      it('answers at least three questions', () => {
        expect(page.faq.length).toBeGreaterThanOrEqual(3);
      });

      it('has a non-empty string in every locale', () => {
        for (const locale of LOCALES) {
          for (const text of copyOf(page, locale)) {
            expect(text.trim().length).toBeGreaterThan(0);
          }
        }
      });

      it('has a title and a description of a sensible length', () => {
        // Chinese carries the same meaning in roughly half the
        // characters, so the bounds are per-locale rather than one
        // number for both.
        const bounds = {
          en: { title: [12, 90], description: [40, 320] },
          zhHant: { title: [6, 40], description: [20, 160] },
        } as const;

        for (const locale of LOCALES) {
          const { title, description } = bounds[locale];
          expect(page.metaTitle[locale].length).toBeGreaterThanOrEqual(title[0]);
          expect(page.metaTitle[locale].length).toBeLessThanOrEqual(title[1]);
          expect(page.metaDescription[locale].length).toBeGreaterThanOrEqual(
            description[0],
          );
          expect(page.metaDescription[locale].length).toBeLessThanOrEqual(
            description[1],
          );
        }
      });

      it('has enough body copy to be worth indexing', () => {
        // A thin page is worse than no page: it spends crawl budget on
        // content nobody would search for.
        expect(wordCount(bodyOf(page, 'en'))).toBeGreaterThanOrEqual(200);
        expect(wordCount(bodyOf(page, 'zhHant'))).toBeGreaterThanOrEqual(150);
      });

      it('links only to guides that exist', () => {
        expect(page.related.length).toBeGreaterThan(0);
        for (const slug of page.related) {
          expect(getGiftPage(slug)).not.toBeNull();
        }
      });
    });
  }
});

describe('no two guides say the same thing', () => {
  it('has a unique title in each locale', () => {
    for (const locale of LOCALES) {
      const titles = GIFT_PAGES.map((page) => page.metaTitle[locale]);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it('has a unique lede in each locale', () => {
    for (const locale of LOCALES) {
      const ledes = GIFT_PAGES.map((page) => page.lede[locale]);
      expect(new Set(ledes).size).toBe(ledes.length);
    }
  });

  it('has a unique body in each locale', () => {
    for (const locale of LOCALES) {
      const bodies = GIFT_PAGES.map((page) => bodyOf(page, locale));
      expect(new Set(bodies).size).toBe(bodies.length);
    }
  });

  it('shares no paragraph between two guides', () => {
    // Duplicated paragraphs are the failure mode of a generated page:
    // every page looks the same to a crawler and to a reader.
    const seen = new Map<string, string>();

    for (const page of GIFT_PAGES) {
      for (const locale of LOCALES) {
        for (const section of page.sections) {
          const text = section.body[locale];
          const owner = seen.get(text);
          expect(
            owner,
            `/${page.slug} repeats a paragraph from /${owner ?? 'another guide'}`,
          ).toBeUndefined();
          seen.set(text, page.slug);
        }
      }
    }
  });
});
