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

  /**
   * The gift that used to break (OOP-6740). The review has an 8000
   * output-token cap and the provider spends most of that reasoning
   * about the gift before it writes the review, so a gift this size —
   * the biggest the builder allows — came back truncated with no tool
   * call in it, and the sender got an error instead of a review. It has
   * to come back with one.
   */
  it.skipIf(!process.env.LOVEBYTE_AI_API_KEY)(
    'returns a review for a gift large enough to fill the output cap',
    async () => {
      const fillTo = (first: string, make: (i: number) => string, bytes: number) => {
        const parts = [first];
        let size = first.length;
        for (let i = 0; size < bytes; i++) {
          const line = make(i);
          parts.push(line);
          size += line.length + 1;
        }
        return parts.join('\n');
      };

      const result = await reviewCodeGift({
        html: fillTo(
          '<h2 id="uploaded">From a file</h2>',
          (i) => `<p class="row row-${i}">Line ${i} of the page they uploaded.</p>`,
          99000,
        ),
        css: fillTo(
          '#uploaded { color: #3d6c0e; }',
          (i) =>
            `.row-${i} { color: #${((i * 7919) % 0xffffff).toString(16).padStart(6, '0')}; margin: ${i % 9}px; }`,
          49000,
        ),
        js: fillTo(
          'document.getElementById("uploaded").dataset.ready = "1";',
          (i) =>
            `document.getElementById("row-${i}")?.addEventListener("click", () => console.log(${i}));`,
          49000,
        ),
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.review.summary.length).toBeGreaterThan(0);
      }
    },
    180000,
  );
});
