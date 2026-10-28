import { describe, it, expect } from 'vitest';
import { reviewCodeGift } from './code-ai';

/**
 * Live check against the configured provider. Skipped unless
 * LOVEBYTE_AI_API_KEY is set — the committed suite must not depend on a
 * live model.
 */
describe('reviewCodeGift (live)', () => {
  it.skipIf(!process.env.LOVEBYTE_AI_API_KEY)(
    'returns a structured review for a gift with a placeholder',
    async () => {
      const result = await reviewCodeGift({
        html: '<h1>Hi {{name}}</h1><img src="https://example.com/photo.jpg" onerror="alert(1)">',
        css: 'h1 { color: red; }',
        js: 'fetch("https://example.com/data.json").then(r=>r.json())',
      });
      console.log(JSON.stringify(result, null, 2));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.review.summary).toBe('string');
        expect(Array.isArray(result.review.questions)).toBe(true);
        expect(Array.isArray(result.review.suggestions)).toBe(true);
      }
    },
    120000,
  );
});
