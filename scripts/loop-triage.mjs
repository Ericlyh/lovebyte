#!/usr/bin/env node
/**
 * Triage the readiness gate's gaps against the board (OOP-5816).
 *
 * The launch-readiness loop fires daily. Its gate is honest, which
 * means that while the Supabase project host is dead it reports the
 * same two gaps every morning: `data-status-unknown` and
 * `data-catalog-empty`. Both are already tracked by OOP-6154, which is
 * blocked on a human with the new project credentials.
 *
 * A loop that files an issue per gap per day does not fix anything; it
 * fills the board with duplicates and drowns the real signal. So the
 * rule is: a gap that is already tracked is NOT a new gap.
 *
 * This script decides that. It is READ-ONLY — it reads the board and
 * prints a plan; the executor performs the writes.
 *
 *   node scripts/loop-triage.mjs                 # run the gate, then triage
 *   node scripts/loop-triage.mjs <gate.json>     # triage a saved gate run
 *
 * How an issue claims a gap: its title or description contains the
 * marker `gap:<id>` (case-insensitive). That marker is what makes the
 * mapping stable across days — the gate's gap ids are stable, so the
 * marker is too.
 */

import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join as joinPath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const API_BASE = (process.env.PAPERCLIP_API_URL ?? 'http://127.0.0.1:3100')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '');
const API_KEY = process.env.PAPERCLIP_API_KEY;
const COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID;

/** Statuses that count as "still being worked on". */
const OPEN_STATUSES = new Set(['todo', 'in_progress', 'in_review', 'blocked']);

/**
 * Priority per gap scope, per the routine's escalation rule.
 *
 *   - a critical route not returning 200, or a dead data layer: an
 *     outage for a user → high
 *   - a slow route, a Lighthouse regression, a missing og tag: a
 *     quality gap the loop can fix on its own → medium
 */
function priorityFor(scope, id) {
  if (id.endsWith('-status') || id.endsWith('-unreachable')) return 'high';
  if (scope === 'data') return 'high';
  // A dead money path is the worst failure mode there is: the customer
  // pays and nothing is fulfilled. Same for the env vars behind it —
  // no key means no email and no checkout (OOP-6168).
  if (scope === 'money' || scope === 'env') return 'high';
  return 'medium';
}

function titleFor(gap) {
  if (gap.scope === 'data') return `Data layer is not serving: ${gap.id}`;
  if (gap.scope === 'http') return `Route gap: ${gap.id}`;
  if (gap.scope === 'lighthouse') return `Quality regression: ${gap.id}`;
  return `Launch gap: ${gap.id}`;
}

async function loadGate() {
  const arg = process.argv[2];
  if (arg && !arg.startsWith('--')) {
    return JSON.parse(readFileSync(arg, 'utf8'));
  }
  const dir = mkdtempSync(join(tmpdir(), 'lb-gate-'));
  const out = join(dir, 'gate.json');
  console.error('running the readiness gate (this takes a minute)…');
  try {
    execFileSync('node', [joinPath(HERE, 'readiness-gate.mjs'), '--json-file', out], {
      stdio: 'inherit',
    });
  } catch {
    // The gate exits 1 when it finds gaps and 2 when it cannot run.
    // Both are legitimate here — the JSON file is what we came for.
  }
  return JSON.parse(readFileSync(out, 'utf8'));
}

async function loadIssues() {
  if (!API_KEY || !COMPANY_ID) {
    throw new Error(
      'PAPERCLIP_API_KEY and PAPERCLIP_COMPANY_ID are required to read the board',
    );
  }
  // Query each open status separately rather than fetching one big list and
  // filtering it here (OOP-7572).
  //
  // The unfiltered list endpoint does not return the NEWEST issues: on
  // 2026-11-16 `?limit=300` and `?limit=1000` both topped out at
  // OOP-7570, so OOP-7571 and OOP-7572 were invisible to this tool even
  // though both were `todo`. The per-status queries reach them
  // (`?status=todo` returns OOP-7572). That matters because of what this
  // tool is FOR: it matches a gap id against the open issues so the loop
  // does not file the same gap every morning. A gap filed today must be
  // VISIBLE to tomorrow's triage, and it was not — the exact case the
  // duplicate rule exists to handle was the one case it failed.
  //
  // Per-status also costs less: only the open issues are fetched (942 on
  // 2026-11-16) instead of a 1000-row window that had to be filtered down
  // to the same set.
  const issues = [];
  const seen = new Set();
  for (const status of OPEN_STATUSES) {
    const res = await fetch(
      `${API_BASE}/api/companies/${COMPANY_ID}/issues?status=${status}&limit=1000`,
      { headers: { Authorization: `Bearer ${API_KEY}` } },
    );
    if (!res.ok) {
      throw new Error(`board read failed: ${res.status} ${await res.text()}`);
    }
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.issues ?? body.data ?? []);
    for (const issue of rows) {
      if (issue?.id && !seen.has(issue.id)) {
        seen.add(issue.id);
        issues.push(issue);
      }
    }
  }
  return issues;
}

/** Does this issue claim this gap? */
function claimsGap(issue, gapId) {
  const text = `${issue.title ?? ''}\n${issue.description ?? ''}`.toLowerCase();
  return text.includes(`gap:${gapId.toLowerCase()}`);
}

const gate = await loadGate();
const issues = await loadIssues();

const plan = [];
for (const gap of gate.gaps ?? []) {
  const trackers = issues.filter((issue) => claimsGap(issue, gap.id));
  if (trackers.length > 0) {
    plan.push({
      gap: gap.id,
      message: gap.message,
      action: 'already-tracked',
      trackedBy: trackers.map((t) => ({
        identifier: t.identifier,
        status: t.status,
        title: t.title,
      })),
      instruction:
        trackers.some((t) => t.status === 'blocked')
          ? 'Blocked on someone else — comment with the current gate result, do NOT file a new issue and do NOT try to fix it.'
          : 'Already tracked — comment with the current gate result, do NOT file a new issue.',
    });
  } else {
    plan.push({
      gap: gap.id,
      message: gap.message,
      action: 'new',
      trackedBy: [],
      instruction: `File a ${priorityFor(gap.scope, gap.id)}-priority issue titled "${titleFor(gap)}" and put "gap:${gap.id}" in its description so the next firing recognises it.`,
    });
  }
}

const summary = {
  verdict: gate.verdict,
  base: gate.base,
  gaps: gate.gaps?.length ?? 0,
  tracked: plan.filter((p) => p.action === 'already-tracked').length,
  new: plan.filter((p) => p.action === 'new').length,
  plan,
};

console.log('\n--- loop triage ---');
console.log(`gate: ${summary.verdict} — ${summary.gaps} gap(s)`);
for (const item of plan) {
  console.log(`\n[${item.action}] ${item.gap}`);
  console.log(`  ${item.message}`);
  for (const t of item.trackedBy) {
    console.log(`  tracked by ${t.identifier} (${t.status}) — ${t.title}`);
  }
  console.log(`  → ${item.instruction}`);
}
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
}
