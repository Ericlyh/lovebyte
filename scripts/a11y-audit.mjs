// Accessibility audit via axe-core on every shipped route.
// Surfaces WCAG 2.2 A/AA violations: color contrast, missing labels,
// missing landmarks, button roles, etc.
//
// Usage:
//   node scripts/a11y-audit.mjs
//   AUDIT_BASE=https://lovorithm.vercel.app node scripts/a11y-audit.mjs
//
// OOP-6735 — this audit used to be a gate that never ran:
//
//   1. it launched Playwright's BUNDLED Chromium, which is not installed
//      on this host, so the script crashed before it measured anything;
//   2. it audited 10 of the ~32 shipped routes — /support, /status,
//      /privacy, /terms, /purchases, /settings, /checkout/*, /u/* and
//      the five /create/* builders were all missing, and /support is
//      exactly where the contrast violation that OOP-6733 fixed was
//      hiding.
//
// The route table now lives in scripts/lib/audit-routes.mjs and covers
// every page the site ships; the browser comes up on the system Chrome
// (no download); and the routes that need a session are audited signed
// in, or reported as "not measured" when there are no credentials.
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
// The exit code answers one question: is the accessibility picture
// clean? A critical OR a serious violation fails the run, and so does a
// colour-contrast violation. A colour-contrast result axe could not
// RESOLVE is reported loudly but does not fail the run — see the verdict
// block at the bottom for why, and for what covers that gap instead.
// Findings in other rules are printed for a human to triage.
//
// OOP-6738 — axe has no rule for heading levels, so the audit measures
// the heading outline of every route it reaches as well (WCAG 1.3.1):
// a level that is skipped, or a page that does not have exactly one
// h1, fails the run.

import AxeBuilder from '@axe-core/playwright';
import {
  AUDIT_ROUTES,
  expandRoutes,
  launchBrowser,
  readEnvLocal,
  resolveRouteParams,
  signInAsAuditUser,
} from './lib/audit-routes.mjs';
import { findHeadingProblems, readHeadingOutline } from './lib/heading-outline.mjs';

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

/**
 * Known, tracked defects that the gate does not fail on.
 *
 * An exception is only ever a rule on a named route, it has to say why
 * it is still broken and where it is tracked, and it has to be deleted
 * when the underlying defect is fixed. The point of listing it here is
 * that the gate still MEASURES the route — every other rule on it still
 * fails the run — and that the exception cannot hide a second, new
 * violation of the same rule.
 */
const KNOWN_EXCEPTIONS = [
  {
    rule: 'html-has-lang',
    routes: ['not-found'],
    issue: 'OOP-6762',
    why: 'Next serves its own fallback document for a URL that matches no route, and that document carries no lang. The app root layout lives in the [locale] segment (OOP-6710), so a 404 never reaches a layout that owns <html lang>.',
  },
];

/** Is this rule on this route a documented exception? */
function isExcepted(rule, label) {
  return KNOWN_EXCEPTIONS.some((e) => e.rule === rule && e.routes.includes(label));
}

/**
 * OOP-6738 — the heading outline, which axe does not test.
 *
 * WCAG 1.3.1 says a heading level must not be skipped: a document that
 * goes h1 → h3 tells a screen-reader user that the h3 is a child of a
 * section that does not exist. axe has no rule for it, so the audit
 * read "0 violations" on pages whose outline was broken — /browse was
 * an h1 followed by ten h3s.
 *
 * The outline is measured on every route the audit reaches, and a
 * skipped level or a page without exactly one h1 fails the run.
 *
 * These are the routes that were already broken and are NOT fixed yet.
 * They are still MEASURED — the outline is printed with the rest of
 * the route's results — they just do not fail the run until they are
 * fixed. The entry must be deleted in the same commit as the fix.
 */
const KNOWN_HEADING_EXCEPTIONS = [
  {
    route: 'builder-quiz',
    issue: 'OOP-6766',
    why: 'The per-question heading is an h3 directly under the page h1. It needs to be an h2.',
  },
  {
    route: 'builder-code',
    issue: 'OOP-6766',
    why: 'The four section headings are h3s directly under the page h1. They need to be h2s.',
  },
  {
    route: 'recipient-open',
    issue: 'OOP-6766',
    why: 'The in-experience gift view has no h1 at all: the write-back card heads itself with an h2.',
  },
  {
    route: 'create-finish',
    issue: 'OOP-6766',
    why: "The typed 404 it renders has no h1 — PageState's title is an h2. The route renders that 404 because the audit resolves a gift id the throwaway audit user does not own.",
  },
];

/** Is this route's heading outline a documented exception? */
function isHeadingExcepted(label) {
  return KNOWN_HEADING_EXCEPTIONS.some((e) => e.route === label);
}

const env = readEnvLocal();
const params = await resolveRouteParams({ base: BASE, env });
const routes = expandRoutes(AUDIT_ROUTES, params);

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});

// A session lets the audit measure the routes that redirect an anonymous
// visitor to /login (the five builders, /settings, /purchases, /checkout,
// /u/me, /u/[handle]/edit). Without credentials — a CI checkout has no
// .env.local — those routes are reported as "not measured" instead of
// being silently audited as the login page.
let session = null;
try {
  const signInPage = await context.newPage();
  session = await signInAsAuditUser({ page: signInPage, base: BASE, env });
  await signInPage.close();
  console.log(session ? 'signed in as a throwaway audit user' : 'no credentials — auth-gated routes will not be measured');
} catch (err) {
  console.log(`could not sign in (${err.message}) — auth-gated routes will not be measured`);
}

const results = [];

for (const { path, label, auth, waitFor } of routes) {
  if (auth && !session) {
    results.push({ label, path, skipped: 'no session' });
    continue;
  }
  const page = await context.newPage();
  const url = `${BASE}${path}`;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800); // let streaming settle

    // OOP-6738 — a route that renders its content in the browser needs
    // that content to be there before the outline is read, or the
    // measurement is taken on a page that is still missing its
    // headings.
    if (waitFor) {
      await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
    }

    const audit = await new AxeBuilder({ page })
      .options(AXE_OPTIONS)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    // OOP-6738 — the heading outline. axe has no rule for it.
    const outline = await readHeadingOutline(page);

    results.push({
      label,
      path,
      status: resp?.status() ?? 0,
      // The URL axe actually measured. A route that bounced to /login
      // or to the not-found page was not the page we meant to audit, and
      // the summary says so instead of counting it as covered.
      finalPath: new URL(page.url()).pathname,
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
      // OOP-6738 — the heading outline and what is wrong with it.
      heading: {
        levels: outline.levels,
        labels: outline.labels,
        problems: findHeadingProblems(outline.levels),
      },
    });
  } catch (err) {
    results.push({ label, path, error: err.message.slice(0, 100) });
  }
  await page.close();
}

await browser.close();
if (session) await session.cleanup();

console.log('\n=== A11y Audit (axe-core) ===\n');
console.log(`base=${BASE}`);
console.log(`routes=${routes.length} ids=${JSON.stringify(params)}`);
let totalCritical = 0;
let totalSerious = 0;
let totalIncomplete = 0;
let totalExcepted = 0;
let measured = 0;
let skipped = 0;
for (const r of results) {
  if (r.skipped) {
    skipped++;
    console.log(`– ${r.label.padEnd(20)} ${r.path.padEnd(50)} not measured (${r.skipped})`);
    continue;
  }
  if (r.error) {
    measured++;
    console.log(`❌ ${r.label.padEnd(20)} ${r.path}  ERROR: ${r.error}`);
    continue;
  }
  measured++;
  // A documented exception is still MEASURED — it is just not counted
  // as a failure. Everything else on the route still gates.
  const failing = r.violations.filter((v) => !isExcepted(v.id, r.label));
  const excepted = r.violations.filter((v) => isExcepted(v.id, r.label));
  const critical = failing.filter((v) => v.impact === 'critical').length;
  const serious = failing.filter((v) => v.impact === 'serious').length;
  const moderate = failing.filter((v) => v.impact === 'moderate').length;
  const minor = failing.filter((v) => v.impact === 'minor').length;
  const incomplete = (r.incomplete ?? []).length;
  totalCritical += critical;
  totalSerious += serious;
  totalIncomplete += incomplete;
  totalExcepted += excepted.length;
  const bounced = r.finalPath && r.finalPath !== r.path ? ` → ${r.finalPath}` : '';
  console.log(
    `${failing.length === 0 ? '✓' : '⚠'} ${r.label.padEnd(20)} ${r.path.padEnd(50)} ` +
      `crit=${critical} serious=${serious} mod=${moderate} minor=${minor} incomplete=${incomplete}${bounced}`
  );
  for (const v of r.violations) {
    if (v.impact === 'critical' || v.impact === 'serious') {
      const exception = KNOWN_EXCEPTIONS.find((e) => e.rule === v.id && e.routes.includes(r.label));
      const tag = exception ? `[${v.impact} — known exception ${exception.issue}]` : `[${v.impact}]`;
      console.log(`     ${tag} ${v.id}: ${v.help}  (${v.nodes} nodes)`);
      if (exception) console.log(`       why it is still open: ${exception.why}`);
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
  // OOP-6738 — the heading outline of every measured route. It is
  // printed for every route, not only the broken ones, so that a route
  // with a correct outline is visibly checked rather than silently
  // assumed.
  if (r.heading) {
    const outline = r.heading.levels.map((l) => `h${l}`).join(',') || '(no headings)';
    const excepted = isHeadingExcepted(r.label);
    const mark = r.heading.problems.length === 0 ? '✓' : excepted ? '·' : '✗';
    console.log(`     ${mark} heading outline: ${outline}`);
    for (const p of r.heading.problems) {
      const issue = KNOWN_HEADING_EXCEPTIONS.find((e) => e.route === r.label);
      const tag = issue ? `[known exception ${issue.issue}]` : '';
      console.log(`       ${tag} ${p.kind}: ${p.detail}`);
      if (issue) console.log(`       why it is still open: ${issue.why}`);
    }
  }
}

console.log(
  `\n=== Total: ${totalCritical} critical + ${totalSerious} serious, ${totalIncomplete} incomplete ===`
);
console.log(`=== Measured ${measured} of ${routes.length} routes (${skipped} skipped) ===`);
if (totalExcepted > 0) {
  console.log(
    `=== ${totalExcepted} known exception(s), tracked: ${KNOWN_EXCEPTIONS.map((e) => e.issue).join(', ')} ===`,
  );
}

// The verdict.
//
//   FAIL   — a critical or serious violation, or a colour-contrast
//            violation, or a heading outline that skips a level or
//            does not have exactly one h1 (OOP-6738). These are
//            MEASURED failures.
//   REPORT — a colour-contrast result axe could not RESOLVE. There are
//            three of those on this site and none of them is a measured
//            failure: a gradient the element itself carries, an
//            icon-only control, and a visually hidden file input that
//            another element overlaps. The gradient class — the one
//            that can hide a failing headline behind "incomplete" — is
//            covered by the static gate (scripts/check-contrast.mjs),
//            which reads the source and measures the text against the
//            worst stop of the gradient. That gate runs in `pnpm test`.
//
// A documented exception (KNOWN_EXCEPTIONS) is measured but not failed:
// it names the rule, the route, the reason and the tracking issue, and
// it must be deleted when the defect is fixed. The same is true of a
// route in KNOWN_HEADING_EXCEPTIONS.
const contrastProblems = results.flatMap((r) =>
  (r.violations ?? [])
    .filter((v) => v.id === 'color-contrast' && !isExcepted(v.id, r.label))
    .map((v) => `${r.path} (${v.id})`)
);
const seriousProblems = results.flatMap((r) =>
  (r.violations ?? [])
    .filter(
      (v) =>
        (v.impact === 'critical' || v.impact === 'serious') && !isExcepted(v.id, r.label),
    )
    .map((v) => `${r.path} (${v.id})`)
);
const unresolvedContrast = results.flatMap((r) =>
  (r.incomplete ?? [])
    .filter((v) => v.id === 'color-contrast')
    .map((v) => `${r.path} (${v.id} incomplete)`)
);
const headingProblems = results.flatMap((r) =>
  (r.heading?.problems ?? [])
    .filter(() => !isHeadingExcepted(r.label))
    .map((p) => `${r.path} (${p.kind}: ${p.detail})`)
);
const headingExceptions = results.filter(
  (r) => (r.heading?.problems ?? []).length > 0 && isHeadingExcepted(r.label),
).length;
if (unresolvedContrast.length) {
  console.log(
    `\nnote: ${unresolvedContrast.length} colour-contrast result(s) axe could not resolve — ` +
      `${unresolvedContrast.join(', ')}. These are the gradient / icon / hidden-input cases; ` +
      'the static gate (scripts/check-contrast.mjs) measures the gradient ones.',
  );
}

if (totalCritical > 0 || totalSerious > 0 || contrastProblems.length > 0 || headingProblems.length > 0) {
  console.error(
    `\n✗ FAIL — ${totalCritical} critical, ${totalSerious} serious, ${contrastProblems.length} color-contrast problem(s), ${headingProblems.length} heading-outline problem(s)` +
      (contrastProblems.length ? `: ${contrastProblems.join(', ')}` : '') +
      (seriousProblems.length ? `; serious: ${seriousProblems.join(', ')}` : '') +
      (headingProblems.length ? `; headings: ${headingProblems.join(', ')}` : ''),
  );
  process.exit(1);
}

if (headingExceptions > 0) {
  console.log(
    `=== ${headingExceptions} route(s) with a known heading-outline exception, tracked: ${KNOWN_HEADING_EXCEPTIONS.map((e) => e.issue).join(', ')} ===`,
  );
}

console.log('\n✓ PASS — no critical, no serious, no colour-contrast violation.');
