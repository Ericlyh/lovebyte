import { describe, it, expect } from 'vitest';
import {
  HANDLE_REGEX,
  HANDLE_MIN_LENGTH,
  HANDLE_MAX_LENGTH,
  isValidHandle,
  normalizeHandle,
  validateHandle,
  handleReasonText,
} from './handle';

/**
 * Smoke tests for the handle format + validation lib (M-B).
 *
 * The DB CHECK constraint in 0002_marketplace_v2.sql is the source of
 * truth — this lib mirrors it for the form layer. Any test that fails
 * here MUST also fail (or the SQL must be updated to match).
 */
describe('handle format constants', () => {
  it('caps length at 3–20 chars', () => {
    expect(HANDLE_MIN_LENGTH).toBe(3);
    expect(HANDLE_MAX_LENGTH).toBe(20);
  });
});

describe('isValidHandle', () => {
  const valid = ['alice', 'b-o-b', 'a1b', 'foo-bar-baz', '123-abc'];
  const invalid = [
    '',
    'a',                       // too short
    'ab',                      // still too short
    'a'.repeat(21),            // too long
    '-alice',                  // leading dash
    'alice-',                  // trailing dash
    'alice bob',               // space
    'alice_bob',               // underscore not allowed
    'alice.bob',               // dot not allowed
    'alice/bob',               // slash not allowed
    // Note: 'A-lice' is intentionally omitted. isValidHandle lowercases
    // first (so 'A-lice' → 'a-lice'), and 'a-lice' passes the regex.
    // That's the right UX — the user typing "Alice" gets "alice" stored.
  ];

  for (const h of valid) {
    it(`accepts ${h}`, () => {
      expect(isValidHandle(h)).toBe(true);
    });
  }
  for (const h of invalid) {
    it(`rejects ${JSON.stringify(h)}`, () => {
      expect(isValidHandle(h)).toBe(false);
    });
  }
});

describe('normalizeHandle', () => {
  it('lowercases', () => {
    expect(normalizeHandle('Alice')).toBe('alice');
  });
  it('trims leading/trailing whitespace', () => {
    expect(normalizeHandle('  alice  ')).toBe('alice');
  });
  it('preserves interior whitespace (so the user sees the typo)', () => {
    expect(normalizeHandle('alice bob')).toBe('alice bob');
  });
});

describe('validateHandle', () => {
  it('returns ok on a valid handle', () => {
    const v = validateHandle('Alice');
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.handle).toBe('alice');
  });

  it('returns empty for null/empty', () => {
    expect(validateHandle('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle(null)).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle(undefined)).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns too_short for <3 chars', () => {
    expect(validateHandle('ab')).toEqual({ ok: false, reason: 'too_short' });
  });

  it('returns too_long for >20 chars', () => {
    expect(validateHandle('a'.repeat(21))).toEqual({ ok: false, reason: 'too_long' });
  });

  it('returns format for bad chars / leading-trailing dash', () => {
    expect(validateHandle('-alice')).toEqual({ ok: false, reason: 'format' });
    expect(validateHandle('alice-')).toEqual({ ok: false, reason: 'format' });
    // Uppercase is normalized to lowercase before the regex check, so
    // "A-lice" → "a-lice" and passes. This matches the DB: handles are
    // stored case-insensitive, so the user typing "Alice" gets "alice".
    expect(validateHandle('alice_bob')).toEqual({ ok: false, reason: 'format' });
  });
});

describe('HANDLE_REGEX matches the DB CHECK', () => {
  // Spot-check a few cases the SQL regex should also accept.
  // If a case passes here but the DB rejects it, the DB CHECK drifted.
  const dbShouldAccept = ['abc', 'a-b', 'a1b', 'abc-def-ghi-jkl-mno'];
  for (const h of dbShouldAccept) {
    it(`DB should accept ${h}`, () => {
      expect(HANDLE_REGEX.test(h)).toBe(true);
    });
  }
});

describe('handleReasonText', () => {
  it('returns English copy for each reason', () => {
    expect(handleReasonText('empty')).toMatch(/pick/i);
    expect(handleReasonText('too_short')).toMatch(/3/);
    expect(handleReasonText('too_long')).toMatch(/20/);
    expect(handleReasonText('format')).toMatch(/lowercase/i);
  });
});
