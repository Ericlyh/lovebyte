import { describe, it, expect } from 'vitest';
import {
  AnimatedLetterPayloadSchema,
  GiftTypeSchema,
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
