import { describe, it, expect } from 'vitest';
import {
  AnimatedLetterPayloadSchema,
  DragdropPuzzlePayloadSchema,
  GiftTypeSchema,
  MemoryCardsPayloadSchema,
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
