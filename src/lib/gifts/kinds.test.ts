import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GIFT_KIND,
  GIFT_KIND_IDS,
  GIFT_KIND_META,
  GIFT_KINDS,
  GiftKindSchema,
  giftKindFromPayload,
  giftKindLabel,
} from './kinds';
import {
  AnimatedLetterPayloadSchema,
  CodeGiftPayloadSchema,
  DragdropPuzzlePayloadSchema,
  MemoryCardsPayloadSchema,
  MultimediaCollagePayloadSchema,
  QuizPayloadSchema,
} from './schemas';

/**
 * The gift-kind catalogue (OOP-7451).
 *
 * The load-bearing assertion here is the LAST one: every payload schema
 * has to KEEP the `kind`. Zod strips unknown keys, so a payload schema
 * that did not declare `kind` would silently drop it — the publish
 * action would write it, the catalogue would read null, and the filter
 * would find nothing. A test that only checks the schema's own shape
 * would not catch that.
 */
describe('gift kinds (OOP-7451)', () => {
  it('accepts every kind in the catalogue', () => {
    for (const kind of GIFT_KIND_IDS) {
      expect(GiftKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects a kind it does not know', () => {
    expect(() => GiftKindSchema.parse('fireworks')).toThrow();
    expect(() => GiftKindSchema.parse('')).toThrow();
  });

  it('gives every kind a label and an emoji', () => {
    for (const kind of GIFT_KIND_IDS) {
      expect(GIFT_KIND_META[kind].label).toBeTruthy();
      expect(GIFT_KIND_META[kind].emoji).toBeTruthy();
    }
  });

  it('lists every kind in the picker, once', () => {
    expect(GIFT_KINDS.map((k) => k.value)).toEqual([...GIFT_KIND_IDS]);
    expect(GIFT_KINDS).toHaveLength(GIFT_KIND_IDS.length);
  });

  it('defaults to "just because"', () => {
    expect(DEFAULT_GIFT_KIND).toBe('just_because');
    expect(GiftKindSchema.parse(DEFAULT_GIFT_KIND)).toBe(DEFAULT_GIFT_KIND);
  });

  it('reads the kind out of a payload', () => {
    expect(giftKindFromPayload({ kind: 'birthday' })).toBe('birthday');
  });

  it('reads no kind out of a payload that has none, or has a bad one', () => {
    expect(giftKindFromPayload(null)).toBeNull();
    expect(giftKindFromPayload({})).toBeNull();
    expect(giftKindFromPayload({ kind: 'fireworks' })).toBeNull();
    expect(giftKindFromPayload('birthday')).toBeNull();
  });

  it('labels a kind it knows, and no kind it does not', () => {
    expect(giftKindLabel('birthday')).toBe(GIFT_KIND_META.birthday.label);
    expect(giftKindLabel('fireworks')).toBeNull();
    expect(giftKindLabel(null)).toBeNull();
  });

  it('keeps the kind in every payload schema', () => {
    const letter = AnimatedLetterPayloadSchema.parse({
      markdown: 'hi',
      kind: 'thank_you',
    });
    expect(letter.kind).toBe('thank_you');

    const cards = MemoryCardsPayloadSchema.parse({
      pairs: [
        { photo_url: 'https://a.test/1.jpg', caption: 'a' },
        { photo_url: 'https://a.test/2.jpg', caption: 'b' },
        { photo_url: 'https://a.test/3.jpg', caption: 'c' },
      ],
      kind: 'friendship',
    });
    expect(cards.kind).toBe('friendship');

    const puzzle = DragdropPuzzlePayloadSchema.parse({
      photo_url: 'https://a.test/1.jpg',
      grid: 3,
      reveal_message: 'for you',
      kind: 'graduation',
    });
    expect(puzzle.kind).toBe('graduation');

    const quiz = QuizPayloadSchema.parse({
      questions: [
        { q: 'a?', options: ['x', 'y'], correct_idx: 0, reveal_msg: 'z' },
      ],
      kind: 'birthday',
    });
    expect(quiz.kind).toBe('birthday');

    const collage = MultimediaCollagePayloadSchema.parse({
      template: 'grid',
      media: [
        {
          type: 'photo',
          url: 'https://a.test/1.jpg',
          position: { x: 0, y: 0, w: 1, h: 1 },
        },
      ],
      kind: 'new_baby',
    });
    expect(collage.kind).toBe('new_baby');

    const code = CodeGiftPayloadSchema.parse({
      html: '<p>hi</p>',
      css: '',
      js: '',
      kind: 'long_distance',
    });
    expect(code.kind).toBe('long_distance');
  });

  it('leaves the kind optional, so a gift written before this still validates', () => {
    const letter = AnimatedLetterPayloadSchema.parse({ markdown: 'hi' });
    expect(letter.kind).toBeUndefined();
  });
});
