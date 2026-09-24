import { describe, it, expect } from 'vitest';
import {
  AnimatedLetterPayloadSchema,
  DragdropPuzzlePayloadSchema,
  GiftTypeSchema,
  MemoryCardsPayloadSchema,
  MultimediaCollagePayloadSchema,
  MultimediaMediaItemSchema,
  QuizPayloadSchema,
  RecipientEnvelopeSchema,
} from './schemas';
import { MOCK_GIFTS, getMockEnvelope } from './mock';

/**
 * Smoke tests for Phase 3 gift infrastructure.
 *
 * Validates the boundaries a recipient view depends on:
 *   1. The mock gift data conforms to the RecipientEnvelope shape
 *      (so the /g/[token] page renders even before Supabase is live).
 *   2. The animated_letter payload schema matches the architecture
 *      doc §3 contract.
 *   3. The gift-type enum is exactly the five Phase 4–8 builders.
 *   4. Unknown tokens return null (so callers can 404).
 */

describe('GiftTypeSchema', () => {
  it('accepts all five Phase 4–8 gift types', () => {
    for (const t of [
      'memory_cards',
      'dragdrop_puzzle',
      'quiz',
      'multimedia_collage',
      'animated_letter',
    ]) {
      expect(GiftTypeSchema.parse(t)).toBe(t);
    }
  });

  it('rejects unknown types', () => {
    expect(() => GiftTypeSchema.parse('fireworks')).toThrow();
    expect(() => GiftTypeSchema.parse('')).toThrow();
  });
});

describe('AnimatedLetterPayloadSchema', () => {
  it('parses the seeded mock letter', () => {
    const seed = (MOCK_GIFTS.demo.payload as unknown);
    const parsed = AnimatedLetterPayloadSchema.parse(seed);
    expect(parsed.paper).toBe('cream');
    expect(parsed.envelope_color).toBe('honey');
    expect(parsed.markdown).toContain('Tai Mo Shan');
    expect(parsed.inline_media).toEqual([]);
  });

  it('rejects empty markdown', () => {
    expect(() =>
      AnimatedLetterPayloadSchema.parse({
        markdown: '',
        paper: 'cream',
        envelope_color: 'honey',
        inline_media: [],
      }),
    ).toThrow();
  });

  it('rejects unknown paper', () => {
    expect(() =>
      AnimatedLetterPayloadSchema.parse({
        markdown: 'hi',
        paper: 'velvet',
        envelope_color: 'honey',
        inline_media: [],
      }),
    ).toThrow();
  });
});

describe('RecipientEnvelopeSchema', () => {
  it('parses the seeded demo envelope', () => {
    const parsed = RecipientEnvelopeSchema.parse(MOCK_GIFTS.demo);
    expect(parsed.shareToken).toBe('demo');
    expect(parsed.senderName).toBe('Eric');
    expect(parsed.giftType).toBe('animated_letter');
  });
});

describe('getMockEnvelope', () => {
  it('returns the demo envelope for the demo token', () => {
    const env = getMockEnvelope('demo');
    expect(env).not.toBeNull();
    expect(env?.senderName).toBe('Eric');
  });

  it('returns null for an unknown token (caller can 404)', () => {
    expect(getMockEnvelope('does-not-exist')).toBeNull();
  });
});

describe('MemoryCardsPayloadSchema (Phase 4, OOP-4219)', () => {
  const validPayload = {
    pairs: [
      { photo_url: 'https://example.com/a.jpg', caption: 'First coffee' },
      { photo_url: 'https://example.com/b.jpg', caption: 'Tai Mo Shan' },
      { photo_url: 'https://example.com/c.jpg', caption: 'Mid-Autumn' },
    ],
    difficulty: 'easy' as const,
    music_url: null,
  };

  it('parses a minimal 3-pair payload', () => {
    const parsed = MemoryCardsPayloadSchema.parse(validPayload);
    expect(parsed.pairs).toHaveLength(3);
    expect(parsed.difficulty).toBe('easy');
    expect(parsed.music_url).toBeNull();
  });

  it('rejects payloads with fewer than 3 pairs', () => {
    expect(() =>
      MemoryCardsPayloadSchema.parse({
        ...validPayload,
        pairs: validPayload.pairs.slice(0, 2),
      }),
    ).toThrow();
  });

  it('rejects payloads with duplicate photo_urls (would be unplayable)', () => {
    expect(() =>
      MemoryCardsPayloadSchema.parse({
        ...validPayload,
        pairs: [
          { photo_url: 'https://example.com/a.jpg', caption: 'one' },
          { photo_url: 'https://example.com/a.jpg', caption: 'two' },
          { photo_url: 'https://example.com/c.jpg', caption: 'three' },
        ],
      }),
    ).toThrow(/unique photo/i);
  });

  it('rejects empty captions', () => {
    expect(() =>
      MemoryCardsPayloadSchema.parse({
        ...validPayload,
        pairs: [
          { photo_url: 'https://example.com/a.jpg', caption: '' },
          { photo_url: 'https://example.com/b.jpg', caption: 'two' },
          { photo_url: 'https://example.com/c.jpg', caption: 'three' },
        ],
      }),
    ).toThrow();
  });

  it('rejects unknown difficulty', () => {
    expect(() =>
      MemoryCardsPayloadSchema.parse({ ...validPayload, difficulty: 'impossible' }),
    ).toThrow();
  });
});

describe('DragdropPuzzlePayloadSchema (Phase 5, OOP-4221)', () => {
  const validPayload = {
    photo_url: 'https://example.com/photo.jpg',
    grid: 3 as const,
    reveal_message: 'Happy anniversary — from the day we got lost in Tokyo',
  };

  it('parses a minimal 3x3 payload', () => {
    const parsed = DragdropPuzzlePayloadSchema.parse(validPayload);
    expect(parsed.grid).toBe(3);
    expect(parsed.photo_url).toBe(validPayload.photo_url);
    expect(parsed.reveal_message).toBe(validPayload.reveal_message);
  });

  it('accepts grids 3, 4, and 5', () => {
    for (const g of [3, 4, 5] as const) {
      const parsed = DragdropPuzzlePayloadSchema.parse({ ...validPayload, grid: g });
      expect(parsed.grid).toBe(g);
    }
  });

  it('rejects grid sizes outside 3/4/5 (game engine only handles those)', () => {
    expect(() =>
      DragdropPuzzlePayloadSchema.parse({ ...validPayload, grid: 6 }),
    ).toThrow();
    expect(() =>
      DragdropPuzzlePayloadSchema.parse({ ...validPayload, grid: 2 }),
    ).toThrow();
  });

  it('rejects empty reveal_message (would give the recipient nothing)', () => {
    expect(() =>
      DragdropPuzzlePayloadSchema.parse({ ...validPayload, reveal_message: '' }),
    ).toThrow();
  });

  it('rejects photo_url that is not a URL', () => {
    expect(() =>
      DragdropPuzzlePayloadSchema.parse({ ...validPayload, photo_url: 'not-a-url' }),
    ).toThrow();
  });
});

describe('QuizPayloadSchema (Phase 6, OOP-4222)', () => {
  const validQuestion = {
    q: 'Where did we first meet?',
    options: ['Tai Mo Shan', 'Causeway Bay MTR', 'Tokyo'],
    correct_idx: 1,
    reveal_msg: 'That rainy Causeway Bay morning ☔',
  };

  const validPayload = {
    questions: [validQuestion],
  };

  it('parses a single-question payload', () => {
    const parsed = QuizPayloadSchema.parse(validPayload);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].correct_idx).toBe(1);
    expect(parsed.questions[0].options).toHaveLength(3);
  });

  it('accepts multiple questions (1–30)', () => {
    const parsed = QuizPayloadSchema.parse({
      questions: Array.from({ length: 5 }, () => validQuestion),
    });
    expect(parsed.questions).toHaveLength(5);
  });

  it('rejects an empty questions array', () => {
    expect(() => QuizPayloadSchema.parse({ questions: [] })).toThrow();
  });

  it('rejects more than 30 questions', () => {
    expect(() =>
      QuizPayloadSchema.parse({
        questions: Array.from({ length: 31 }, () => validQuestion),
      }),
    ).toThrow();
  });

  it('rejects fewer than 2 options on a question', () => {
    expect(() =>
      QuizPayloadSchema.parse({
        questions: [{ ...validQuestion, options: ['only one'] }],
      }),
    ).toThrow();
  });

  it('rejects more than 6 options on a question', () => {
    expect(() =>
      QuizPayloadSchema.parse({
        questions: [
          {
            ...validQuestion,
            options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects correct_idx that points past the options array', () => {
    expect(() =>
      QuizPayloadSchema.parse({
        questions: [{ ...validQuestion, correct_idx: 5 }],
      }),
    ).toThrow(/correct_idx/);
  });

  it('rejects empty question text', () => {
    expect(() =>
      QuizPayloadSchema.parse({
        questions: [{ ...validQuestion, q: '' }],
      }),
    ).toThrow();
  });

  it('rejects empty reveal_msg (the gift payoff)', () => {
    expect(() =>
      QuizPayloadSchema.parse({
        questions: [{ ...validQuestion, reveal_msg: '' }],
      }),
    ).toThrow();
  });
});

describe('MultimediaMediaItemSchema (Phase 7, OOP-4223)', () => {
  const validItem = {
    type: 'photo' as const,
    url: 'https://example.com/photo.jpg',
    caption: 'That rainy Causeway Bay morning',
    position: { x: 0.1, y: 0.1, w: 0.3, h: 0.4 },
  };

  it('parses a minimal photo item with caption and position', () => {
    const parsed = MultimediaMediaItemSchema.parse(validItem);
    expect(parsed.type).toBe('photo');
    expect(parsed.position.x).toBe(0.1);
  });

  it('accepts video and audio kinds', () => {
    for (const t of ['photo', 'video', 'audio'] as const) {
      const parsed = MultimediaMediaItemSchema.parse({ ...validItem, type: t });
      expect(parsed.type).toBe(t);
    }
  });

  it('rejects unknown kinds', () => {
    expect(() =>
      MultimediaMediaItemSchema.parse({ ...validItem, type: 'gif' }),
    ).toThrow();
  });

  it('rejects position out of 0..1 range', () => {
    expect(() =>
      MultimediaMediaItemSchema.parse({
        ...validItem,
        position: { x: 1.5, y: 0, w: 0.3, h: 0.3 },
      }),
    ).toThrow();
    expect(() =>
      MultimediaMediaItemSchema.parse({
        ...validItem,
        position: { x: 0, y: -0.1, w: 0.3, h: 0.3 },
      }),
    ).toThrow();
  });

  it('rejects zero-size items (would render as nothing on the canvas)', () => {
    expect(() =>
      MultimediaMediaItemSchema.parse({
        ...validItem,
        position: { x: 0, y: 0, w: 0, h: 0.3 },
      }),
    ).toThrow();
  });
});

describe('MultimediaCollagePayloadSchema (Phase 7, OOP-4223)', () => {
  const validPayload = {
    template: 'polaroid-wall',
    media: [
      {
        type: 'photo' as const,
        url: 'https://example.com/a.jpg',
        caption: 'Tai Mo Shan',
        position: { x: 0.04, y: 0.05, w: 0.28, h: 0.42 },
      },
      {
        type: 'video' as const,
        url: 'https://example.com/b.mp4',
        caption: 'The proposal clip',
        position: { x: 0.36, y: 0.08, w: 0.28, h: 0.42 },
      },
      {
        type: 'audio' as const,
        url: 'https://example.com/c.mp3',
        position: { x: 0.68, y: 0.05, w: 0.28, h: 0.42 },
      },
    ],
    music_url: 'https://example.com/bg.mp3',
  };

  it('parses a minimal mixed-media payload', () => {
    const parsed = MultimediaCollagePayloadSchema.parse(validPayload);
    expect(parsed.template).toBe('polaroid-wall');
    expect(parsed.media).toHaveLength(3);
    expect(parsed.music_url).toBe(validPayload.music_url);
  });

  it('defaults music_url to null when omitted', () => {
    const parsed = MultimediaCollagePayloadSchema.parse({
      template: 'timeline',
      media: validPayload.media.slice(0, 1),
    });
    expect(parsed.music_url).toBeNull();
  });

  it('accepts up to 20 media items', () => {
    const media = Array.from({ length: 20 }, (_, i) => ({
      type: 'photo' as const,
      url: `https://example.com/${i}.jpg`,
      position: {
        x: (i % 5) * 0.2,
        y: Math.floor(i / 5) * 0.2,
        w: 0.18,
        h: 0.18,
      },
    }));
    const parsed = MultimediaCollagePayloadSchema.parse({
      template: 'timeline',
      media,
    });
    expect(parsed.media).toHaveLength(20);
  });

  it('rejects more than 20 media items', () => {
    const media = Array.from({ length: 21 }, (_, i) => ({
      type: 'photo' as const,
      url: `https://example.com/${i}.jpg`,
      position: { x: 0, y: 0, w: 0.18, h: 0.18 },
    }));
    expect(() =>
      MultimediaCollagePayloadSchema.parse({ template: 'timeline', media }),
    ).toThrow();
  });

  it('rejects empty media array', () => {
    expect(() =>
      MultimediaCollagePayloadSchema.parse({ template: 'timeline', media: [] }),
    ).toThrow();
  });

  it('rejects empty template id', () => {
    expect(() =>
      MultimediaCollagePayloadSchema.parse({
        template: '',
        media: validPayload.media.slice(0, 1),
      }),
    ).toThrow();
  });
});
