import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  checkPasswordRules,
  isPasswordOk,
} from './password';

describe('checkPasswordRules', () => {
  it('flags too short + neutral on max when empty', () => {
    expect(checkPasswordRules('')).toEqual([
      { id: 'min_length', ok: false },
      { id: 'max_length', ok: true },
    ]);
  });

  it('accepts a normal-length password', () => {
    const rules = checkPasswordRules('hunter22');
    expect(rules).toEqual([
      { id: 'min_length', ok: true },
      { id: 'max_length', ok: true },
    ]);
    expect(isPasswordOk('hunter22')).toBe(true);
  });

  it('accepts exactly the minimum length', () => {
    const pwd = 'a'.repeat(PASSWORD_MIN_LENGTH);
    expect(isPasswordOk(pwd)).toBe(true);
  });

  it('rejects below the minimum length', () => {
    expect(isPasswordOk('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
  });

  it('rejects above the maximum length (Supabase hard limit)', () => {
    const pwd = 'a'.repeat(PASSWORD_MAX_LENGTH + 1);
    const rules = checkPasswordRules(pwd);
    expect(rules[0].ok).toBe(true);
    expect(rules[1].ok).toBe(false);
    expect(isPasswordOk(pwd)).toBe(false);
  });

  it('accepts exactly the maximum length', () => {
    const pwd = 'a'.repeat(PASSWORD_MAX_LENGTH);
    expect(isPasswordOk(pwd)).toBe(true);
  });
});
