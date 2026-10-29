import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The palette contrast gate (OOP-6733).
 *
 * Why this runs as a test and not as part of the axe audit: axe cannot
 * judge a gradient background, so it reports the hero headline as
 * "incomplete" rather than a violation, and it never samples a `:hover`
 * state at all. Both of the failures this pins were invisible to the
 * audit that was supposed to catch them — it read "0 violations" on the
 * largest text on the site.
 *
 * So the check is static: scripts/check-contrast.mjs parses the palette
 * tokens and the shared stylesheet, resolves what colour each guarded
 * rule actually paints its text with, and compares it against the
 * background behind it — both ends of a gradient included. A palette
 * edit that lightens --lb-primary-deep fails here, without a deploy.
 */
describe('palette contrast gate', () => {
  const script = path.join(process.cwd(), 'scripts', 'check-contrast.mjs');

  it('every guarded text colour meets its WCAG AA threshold', () => {
    let output = '';
    try {
      output = execFileSync('node', [script], { encoding: 'utf8' });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      throw new Error(
        `scripts/check-contrast.mjs exited non-zero.\n${e.stdout ?? ''}\n${e.stderr ?? ''}`,
      );
    }
    expect(output).toContain('✓ PASS');
  });
});
