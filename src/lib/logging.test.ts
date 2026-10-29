import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No `console.log` in application code (OOP-6739).
 *
 * `console.log` is unstructured stdout. On a serverless function that
 * means the line goes into Vercel's log retention verbatim — no
 * severity, no searchable field, and no alert will ever match it. It
 * is also the level people reach for when they mean to log *something
 * notable*, so the two drifts together: the log ends up carrying the
 * payload nobody meant to keep (an email address, a request body) and
 * the events that deserve an alert stay buried in the log tail.
 *
 * The rule this test enforces is the same one the rest of the codebase
 * already follows by convention: `console.error` for a fault,
 * `console.warn` for something an operator should look at,
 * `console.info` for a trace of an expected path. `console.log` has no
 * place in that scheme.
 *
 * It is enforced rather than merely observed because the alternative is
 * a cleanup that silently regresses: the next `console.log` is one
 * review away, and nothing fails when it lands.
 */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SRC_DIR, '..');

/** The extensions that can hold application code. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/**
 * A call to `console.log` — the opening paren is what makes this a
 * CALL rather than a mention of the name in a comment or a doc block.
 */
const CONSOLE_LOG_CALL = /console\.log\s*\(/;

/**
 * The call sites that are allowed to use `console.log`.
 *
 * Each entry is matched on the file AND on the shape of the line, so
 * moving the file or adding a line above it does not silently widen
 * the exemption — a NEW `console.log` anywhere in `email.ts` still
 * fails this test.
 */
const ALLOWED: { file: string; match: RegExp }[] = [
  {
    // OOP-6739 acceptance criterion 4 — `src/lib/email.ts` is
    // deliberately left alone. This is the dev-only Resend stub: it
    // runs ONLY when `RESEND_API_KEY` is unset AND `NODE_ENV` is not
    // 'production', and in production the sibling branch logs an
    // error and refuses to report an unsent email as sent. A stub
    // that prints the message it would have sent is the point of a
    // stub, and it never reaches a retained serverless log.
    file: 'src/lib/email.ts',
    match: /console\.log\(\s*`\[email\/stub\]/,
  },
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

/** A test file may log freely — it is not application code. */
function isTestFile(file: string): boolean {
  const base = path.basename(file);
  return base.includes('.test.') || base.includes('.spec.');
}

function findConsoleLogViolations(): string[] {
  const violations: string[] = [];
  for (const file of sourceFiles(SRC_DIR)) {
    if (isTestFile(file)) continue;
    const rel = path.relative(REPO_ROOT, file);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!CONSOLE_LOG_CALL.test(line)) return;
      const allowed = ALLOWED.some(
        (rule) => rule.file === rel && rule.match.test(line),
      );
      if (!allowed) {
        violations.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return violations.sort();
}

describe('logging hygiene', () => {
  it('has no console.log in application code', () => {
    expect(findConsoleLogViolations()).toEqual([]);
  });
});
