#!/usr/bin/env node
/**
 * Palette contrast gate (OOP-6733).
 *
 * A static check: no server, no browser, no axe. It parses the palette
 * tokens and the shared stylesheet, resolves the colour each guarded
 * rule actually paints its text with, and compares it against the
 * background that rule really sits on — including BOTH ends of a
 * gradient, which is the case axe cannot judge (it skips the element
 * and reports "incomplete", so the audit reads "0 violations" on the
 * largest text on the site).
 *
 * Run it:  node scripts/check-contrast.mjs
 * Gate it: pnpm test   (src/styles/contrast.test.ts runs this script)
 *
 * Why static: the failures this exists to prevent are silent. axe
 * reports "0 violations" on the hero headline because it cannot
 * resolve a gradient background, and it never samples a :hover state
 * at all. A palette edit that lightens --lb-primary-deep has to fail
 * something, and it has to fail without a deploy.
 *
 * The invariant it enforces, in one line:
 *   --lb-primary is a FILL token. No text may be painted with it.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PALETTE_FILE = path.join(ROOT, 'src/styles/palettes/tokens-warm-romantic.css');
const SHARED_FILE = path.join(ROOT, 'src/styles/shared-tokens.css');

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Token name → hex, following `var(--x)` aliases. */
function parseTokens(css) {
  const raw = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) raw[m[1]] = m[2].trim();

  const tokens = {};
  const resolve = (name, seen = new Set()) => {
    if (name in tokens) return tokens[name];
    if (seen.has(name) || !(name in raw)) return null;
    seen.add(name);
    const value = raw[name];
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) {
      tokens[name] = value;
      return value;
    }
    const alias = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
    if (alias) {
      const resolved = resolve(alias[1], seen);
      if (resolved) tokens[name] = resolved;
      return resolved;
    }
    return null;
  };
  for (const name of Object.keys(raw)) resolve(name);
  return tokens;
}

/**
 * Flat rule list. Selectors are split on commas; declarations are
 * collected per rule. At-rule wrappers (@media) are not tracked — the
 * guarded selectors below have no media-scoped overrides.
 */
function parseRules(css) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const decls = {};
    for (const d of m[2].matchAll(/([-a-zA-Z]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    rules.push({ selectors, decls });
  }
  return rules;
}

/** Declarations that apply to an exact selector, later rules winning. */
function effectiveDecls(rules, selector) {
  const decls = {};
  for (const rule of rules) {
    if (rule.selectors.includes(selector)) Object.assign(decls, rule.decls);
  }
  return decls;
}

/* ------------------------------------------------------------------ *
 * Colour maths
 * ------------------------------------------------------------------ */

/** Resolve a CSS colour value to `#rrggbb`, following var() and fallbacks. */
function resolveColour(expr, tokens) {
  if (!expr) return null;
  const value = expr.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value;
  const v = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/);
  if (v) {
    if (tokens[v[1]]) return tokens[v[1]];
    return v[2] ? resolveColour(v[2], tokens) : null;
  }
  return null;
}

/** Every colour stop in a `linear-gradient(...)` value. */
function gradientStops(value, tokens) {
  const stops = [];
  for (const m of value.matchAll(/var\(\s*--[\w-]+\s*(?:,[^)]*)?\)|#[0-9a-fA-F]{3,8}/g)) {
    const c = resolveColour(m[0], tokens);
    if (c) stops.push(c);
  }
  return stops;
}

function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ *
 * The guards
 * ------------------------------------------------------------------ */

/**
 * Each guard names the rule that paints the text, the rules that could
 * paint the background behind it (first match wins, `body` last), and
 * the WCAG 1.4.3 threshold that applies — 3:1 for large text (>=24px,
 * or >=18.66px bold), 4.5:1 for everything else.
 */
const GUARDS = [
  {
    name: 'landing hero h1',
    selector: '.lb-landing-hero h1',
    background: ['.lb-landing-hero', 'body'],
    min: 3,
    why: 'clamp(56px,10vw,128px) — large text',
  },
  {
    name: 'browse hero title',
    selector: '.lb-browse-hero__title',
    background: ['.lb-browse-hero', 'body'],
    min: 3,
    why: 'clamp(40px,7vw,72px) — large text',
  },
  {
    name: 'listing hero title',
    selector: '.lb-listing-hero__title',
    background: ['.lb-listing-hero', 'body'],
    min: 3,
    why: 'clamp(36px,6vw,56px) — large text',
  },
  {
    name: 'profile hero h1',
    selector: '.lb-profile-hero h1',
    background: ['.lb-profile-hero', 'body'],
    min: 3,
    why: 'clamp(36px,6vw,56px) — large text',
  },
  {
    name: 'recipient cover message',
    selector: '.lb-recipient__cover',
    background: ['.lb-recipient__cover', 'body'],
    min: 4.5,
    why: '15px gift message on a gradient card',
  },
  {
    name: 'link (resting)',
    selector: 'a',
    background: ['body'],
    min: 4.5,
    why: 'body text',
  },
  {
    name: 'link (hover)',
    selector: 'a:hover',
    background: ['body'],
    min: 4.5,
    why: 'body text, transient state',
  },
  {
    name: 'support card mailto link',
    selector: '.lb-support-card a',
    background: ['.lb-support-card', 'body'],
    min: 4.5,
    why: '16px body text on a raised card',
  },
  {
    name: 'profile link (hover)',
    selector: '.lb-profile-links li a:hover',
    background: ['body'],
    min: 4.5,
    why: '14px body text, transient state',
  },
  {
    name: 'profile about link (hover)',
    selector: '.lb-profile-section__about-links li a:hover',
    background: ['body'],
    min: 4.5,
    why: '14px body text, transient state',
  },
];

/** The fill token. Text may never be painted with it. */
const FILL_TOKEN = '--lb-primary';
const FILL_TOKEN_RE = /var\(\s*--lb-primary\s*[,)]/;

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const paletteCss = stripComments(readFileSync(PALETTE_FILE, 'utf8'));
const sharedCss = stripComments(readFileSync(SHARED_FILE, 'utf8'));

const tokens = parseTokens(paletteCss);
const rules = parseRules(sharedCss);

const failures = [];
const rows = [];

/**
 * Every colour that can be behind the text: the element's own
 * background, and the background of a decorative ::before wash on it
 * (the hero gradients live there — see OOP-6733). A gradient counts as
 * ALL of its stops, so the text is measured against the darkest one.
 */
function backgroundCandidates(rules, selectors, tokens) {
  const out = [];
  const add = (value) => {
    if (!value) return;
    if (value.includes('gradient')) {
      out.push(...gradientStops(value, tokens));
      return;
    }
    const c = resolveColour(value, tokens);
    if (c) out.push(c);
  };
  for (const sel of selectors) {
    const decls = effectiveDecls(rules, sel);
    add(decls.background);
    add(decls['background-color']);
    const before = effectiveDecls(rules, `${sel}::before`);
    add(before.background);
    add(before['background-color']);
  }
  return out.length ? out : null;
}

for (const guard of GUARDS) {
  const decls = effectiveDecls(rules, guard.selector);
  const fg = resolveColour(decls.color, tokens);

  const bgs = backgroundCandidates(rules, guard.background, tokens);

  if (!fg) {
    failures.push(`${guard.name}: no resolvable colour on \`${guard.selector}\``);
    rows.push({ guard: guard.name, fg: '?', bg: '?', ratio: '?', min: guard.min, ok: false });
    continue;
  }
  if (!bgs) {
    failures.push(`${guard.name}: no resolvable background behind \`${guard.selector}\``);
    rows.push({ guard: guard.name, fg, bg: '?', ratio: '?', min: guard.min, ok: false });
    continue;
  }

  let worst = Infinity;
  let worstBg = bgs[0];
  for (const bg of bgs) {
    const r = contrast(fg, bg);
    if (r < worst) {
      worst = r;
      worstBg = bg;
    }
  }
  const ok = worst >= guard.min;
  if (!ok) {
    failures.push(
      `${guard.name}: ${worst.toFixed(2)}:1 (${fg} on ${worstBg}) — needs ${guard.min}:1`,
    );
  }
  rows.push({
    guard: guard.name,
    fg,
    bg: bgs.length > 1 ? `${worstBg} (worst of ${bgs.length})` : bgs[0],
    ratio: worst.toFixed(2),
    min: guard.min,
    ok,
  });
}

/* The global invariant: --lb-primary is a fill token, never a text colour. */
for (const rule of rules) {
  const c = rule.decls.color;
  if (!c || !FILL_TOKEN_RE.test(c)) continue;
  failures.push(
    `text painted with the fill token ${FILL_TOKEN}: \`${rule.selectors.join(', ')}\` — ${c}`,
  );
}

/**
 * And the other way round: the fill token must never carry a label.
 * White on --lb-primary is 2.81:1, so any rule that paints text on that
 * fill fails WCAG AA — 4.5:1 for body text, 3:1 for large text. This is
 * the rule that Phase 9 (OOP-4225) applied to the CTA buttons and
 * missed everywhere else: the step badge, the quiz buttons, the liked
 * button, the creator badge, the memory-card back.
 */
for (const rule of rules) {
  const bg = rule.decls.background;
  const fg = rule.decls.color;
  if (!bg || !fg) continue;
  if (!FILL_TOKEN_RE.test(bg)) continue;

  const bgColour = resolveColour(bg, tokens);
  const fgColour = resolveColour(fg, tokens);
  if (!bgColour || !fgColour) continue;

  const ratio = contrast(fgColour, bgColour);
  // Large text: >=24px, or >=18.66px bold. A rule that does not declare
  // a font-size is measured against the strict 4.5:1.
  const fontSize = parseFloat(rule.decls['font-size'] ?? '');
  const weight = rule.decls['font-weight'] ?? '';
  const bold = weight === 'bold' || Number(weight) >= 700;
  const large = Number.isFinite(fontSize) && (fontSize >= 24 || (bold && fontSize >= 18.66));
  const min = large ? 3 : 4.5;

  if (ratio < min) {
    failures.push(
      `label on the fill token: \`${rule.selectors.join(', ')}\` — ${fg} on ${bg} is ` +
        `${ratio.toFixed(2)}:1, needs ${min}:1`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

console.log('=== Palette contrast gate (OOP-6733) ===\n');
for (const row of rows) {
  const mark = row.ok ? '✓' : '✗';
  console.log(
    `${mark} ${row.guard.padEnd(28)} ${String(row.fg).padEnd(9)} on ${String(row.bg).padEnd(24)} ` +
      `${String(row.ratio).padStart(6)}:1  (needs ${row.min}:1)`,
  );
}

const fillUses = [];
for (const rule of rules) {
  if (rule.decls.color && FILL_TOKEN_RE.test(rule.decls.color)) {
    fillUses.push(rule.selectors.join(', '));
  }
}
console.log(
  `\nText colours painted with ${FILL_TOKEN}: ${fillUses.length === 0 ? 'none' : fillUses.join(' | ')}`,
);

if (failures.length) {
  console.error(`\n✗ FAIL — ${failures.length} contrast failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('\n✓ PASS — every guarded text colour meets its WCAG AA threshold.');
