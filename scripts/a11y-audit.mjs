// Accessibility audit via axe-core on every shipped route.
// Surfaces WCAG 2.2 A/AA violations: color contrast, missing labels,
// missing landmarks, button roles, etc.
//
// Usage:  pnpm dev   (in another terminal, leave running)
//         node scripts/a11y-audit.mjs
//
// Phase 9 (OOP-4225) — acceptance criterion: keyboard nav + ARIA on
// builders, ARIA on card-flip / drag-puzzle / quiz / collage-canvas.

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:3100';

const ROUTES = [
  { path: '/', label: 'landing' },
  { path: '/browse', label: 'browse' },
  { path: '/g/demo', label: 'recipient-demo' },
  { path: '/g/this-token-does-not-exist', label: 'recipient-404' },
  { path: '/l/00000000-0000-0000-0000-000000000000', label: 'listing-404' },
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/create', label: 'create' },
  { path: '/onboarding', label: 'onboarding' },
  { path: '/random-404', label: 'random-404' },
];

const browser = await chromium.launch();
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
for (const r of results) {
  if (r.error) {
    console.log(`❌ ${r.label.padEnd(20)} ${r.path}  ERROR: ${r.error}`);
    continue;
  }
  const critical = r.violations.filter((v) => v.impact === 'critical').length;
  const serious = r.violations.filter((v) => v.impact === 'serious').length;
  const moderate = r.violations.filter((v) => v.impact === 'moderate').length;
  const minor = r.violations.filter((v) => v.impact === 'minor').length;
  totalCritical += critical;
  totalSerious += serious;
  console.log(
    `${r.violations.length === 0 ? '✓' : '⚠'} ${r.label.padEnd(20)} ${r.path.padEnd(50)} ` +
      `crit=${critical} serious=${serious} mod=${moderate} minor=${minor}`
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
}

console.log(
  `\n=== Total: ${totalCritical} critical + ${totalSerious} serious ===`
);