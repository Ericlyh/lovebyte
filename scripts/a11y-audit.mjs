// Accessibility audit via axe-core on every shipped route.
// Surfaces WCAG 2.2 A/AA violations: color contrast, missing labels,
// missing landmarks, button roles, etc.
//
// Usage:  pnpm dev   (in another terminal, leave running)
//         node scripts/a11y-audit.mjs
//
// Phase 9 (OOP-4225) — acceptance criterion: keyboard nav + ARIA on
// builders, ARIA on card-flip / drag-puzzle / quiz / collage-canvas.
//
// OOP-6733 — the colour-contrast rule runs with two of axe's documented
// check options:
//
//   ignorePseudo — by default axe treats ANY pseudo-element overlapping
//     the text as an unknown background and reports the element
//     "incomplete". The hero gradients are decorative ::before washes;
//     the element underneath them carries a solid background colour (the
//     gradient's darkest stop), which is the conservative thing to
//     measure against. Nothing on this site draws a text background on
//     a pseudo-element, so nothing is masked.
//
//   ignoreLength — by default axe skips text it cannot measure, such as
//     a single character. That is how the step-number badge (a lone
//     digit in a coral circle) hid a 2.81:1 label behind "incomplete".
//
// The exit code answers one question: is the colour-contrast picture
// clean? Everything else the audit finds is printed for a human to
// triage.

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3100';

const AXE_OPTIONS = {
  rules: {
    'color-contrast': {
      checks: {
        'color-contrast': {
          options: { ignorePseudo: true, ignoreLength: true },
        },
      },
    },
  },
};

const ROUTES = [
  { path: '/', label: 'landing' },
  { path: '/browse', label: 'browse' },
  { path: '/support', label: 'support' },
  { path: '/g/demo', label: 'recipient-demo' },
  { path: '/g/this-token-does-not-exist', label: 'recipient-404' },
  { path: '/l/00000000-0000-0000-0000-000000000000', label: 'listing-404' },
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/create', label: 'create' },
  { path: '/onboarding', label: 'onboarding' },
  { path: '/random-404', label: 'random-404' },
];

// Playwright's bundled Chromium is not installed everywhere (OOP-6733:
// this host has system Chrome and no ms-playwright cache). Try the
// bundled browser first, fall back to the system Chrome.
const browser = await chromium
  .launch()
  .catch(() => chromium.launch({ channel: 'chrome' }));
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});

const results = [];

for (const { path, label } of ROUTES) {
  const page = await context.newPage();
  const url = `${BASE}${path}`;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800); // let streaming settle

    const audit = await new AxeBuilder({ page })
      .options(AXE_OPTIONS)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    results.push({
      label,
      path,
      status: resp?.status() ?? 0,
      violations: audit.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        samples: v.nodes.slice(0, 2).map((n) => ({
          target: n.target.join(' / '),
          failureSummary: n.failureSummary,
        })),
      })),
      // OOP-6733 — an "incomplete" result is NOT a pass. axe reports
      // "incomplete" when it cannot determine a background (a gradient
      // hero) and skips the element, so a page can read "0 violations"
      // while the largest text on it fails WCAG. Counted and printed
      // separately so that silence cannot be mistaken for a clean bill.
      incomplete: audit.incomplete.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
        samples: v.nodes.slice(0, 2).map((n) => ({
          target: n.target.join(' / '),
          failureSummary: n.failureSummary,
        })),
      })),
    });
  } catch (err) {
    results.push({ label, path, error: err.message.slice(0, 100) });
  }
  await page.close();
}

await browser.close();

console.log('\n=== A11y Audit (axe-core) ===\n');
let totalCritical = 0;
let totalSerious = 0;
let totalIncomplete = 0;
for (const r of results) {
  if (r.error) {
    console.log(`❌ ${r.label.padEnd(20)} ${r.path}  ERROR: ${r.error}`);
    continue;
  }
  const critical = r.violations.filter((v) => v.impact === 'critical').length;
  const serious = r.violations.filter((v) => v.impact === 'serious').length;
  const moderate = r.violations.filter((v) => v.impact === 'moderate').length;
  const minor = r.violations.filter((v) => v.impact === 'minor').length;
  const incomplete = (r.incomplete ?? []).length;
  totalCritical += critical;
  totalSerious += serious;
  totalIncomplete += incomplete;
  console.log(
    `${r.violations.length === 0 ? '✓' : '⚠'} ${r.label.padEnd(20)} ${r.path.padEnd(50)} ` +
      `crit=${critical} serious=${serious} mod=${moderate} minor=${minor} incomplete=${incomplete}`
  );
  for (const v of r.violations) {
    if (v.impact === 'critical' || v.impact === 'serious') {
      console.log(`     [${v.impact}] ${v.id}: ${v.help}  (${v.nodes} nodes)`);
      for (const s of v.samples) {
        console.log(`       target: ${typeof s === 'string' ? s : s.target}`);
        if (typeof s === 'object' && s.failureSummary) {
          console.log(`       why: ${s.failureSummary.replace(/\n/g, ' / ')}`);
        }
      }
    }
  }
  for (const v of r.incomplete ?? []) {
    console.log(`     [incomplete] ${v.id}: ${v.help}  (${v.nodes} nodes)`);
    for (const s of v.samples) {
      console.log(`       target: ${typeof s === 'string' ? s : s.target}`);
      if (typeof s === 'object' && s.failureSummary) {
        console.log(`       why: ${s.failureSummary.replace(/\n/g, ' / ')}`);
      }
    }
  }
}

console.log(
  `\n=== Total: ${totalCritical} critical + ${totalSerious} serious, ${totalIncomplete} incomplete ===`
);

// OOP-6733 — the exit code is the colour gate: a color-contrast
// violation, a color-contrast result axe could not resolve, or a
// critical violation of any rule. Findings in other rules are printed
// above for a human to triage.
const contrastProblems = results.flatMap((r) => [
  ...(r.violations ?? [])
    .filter((v) => v.id === 'color-contrast')
    .map((v) => `${r.path} (${v.id})`),
  ...(r.incomplete ?? [])
    .filter((v) => v.id === 'color-contrast')
    .map((v) => `${r.path} (${v.id} incomplete)`),
]);
if (totalCritical > 0 || contrastProblems.length > 0) {
  console.error(
    `\n✗ FAIL — ${totalCritical} critical, ${contrastProblems.length} color-contrast problem(s)` +
      (contrastProblems.length ? `: ${contrastProblems.join(', ')}` : ''),
  );
  process.exit(1);
}