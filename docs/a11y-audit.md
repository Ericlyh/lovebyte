# Accessibility gate — executor spec

Paperclip routine **Paperclip: Lovorithm Accessibility Gate**
(triage target: OOP-5816). This file is the executor's spec: what a
single firing of the routine does, in order, and what "done" means.

The gate itself is `scripts/a11y-audit.mjs` — an axe-core sweep over
every page the site ships. It is the accessibility half of the launch
readiness work; `docs/readiness-loop.md` is the launch-readiness half.

Why this exists (OOP-6735): the audit script crashed before it measured
anything (it launched Playwright's bundled Chromium, which is not
installed on this host), it audited 10 of the ~32 shipped routes, and
the Lighthouse script could never pass because one of its targets was an
image endpoint. A gate that cannot run is worse than no gate: the board
read "audit ran clean" while nothing had been measured.

---

## 0. Preflight

```bash
cd /Users/molt/Developer/lovebyte
git log --oneline -5 origin/main && git status --short
```

The audit runs against PRODUCTION, so the checkout only has to be
readable — it does not have to be clean or up to date. (Unlike the
readiness loop, this gate never fixes anything in place; it reports.)

## 1. Run the objective gate

```bash
AUDIT_BASE=https://lovorithm.vercel.app node scripts/a11y-audit.mjs
```

The exit code IS the verdict:

| exit | meaning | what to do |
|------|---------|------------|
| 0 | no critical, no serious, no colour-contrast violation | post the summary, stop |
| 1 | a critical or serious violation, or a colour-contrast violation | file an issue (step 3) |
| other | the audit could not run (no browser, no route reachable) | file a "the gate could not run" issue (step 3) |

The audit needs the system Chrome — `chromium.launch({ channel: 'chrome' })`,
not Playwright's bundled build. Do NOT run `npx playwright install`; it is
a large download and the host already has Chrome. On a machine without
system Chrome, set `PW_CHANNEL=chromium` and install Playwright's
Chromium instead.

It signs in with a throwaway user (created over the Supabase admin API
from `.env.local`, deleted again in a `finally` block) so the gated
routes — the five `/create/*` builders, `/settings`, `/purchases`,
`/checkout/*`, `/u/me` — are measured instead of bouncing to `/login`.
Without `.env.local` those routes are reported as `not measured`; the
run summary says how many routes were measured.

## 2. Read the output

The summary line is the number to quote:

```
=== Total: 0 critical + 0 serious, 5 incomplete ===
=== Measured 33 of 33 routes (0 skipped) ===
```

- `critical` / `serious` — measured failures. The gate fails on these.
- `incomplete` — axe could not resolve a background. On this site those
  are the gradient, icon-only-control and hidden-input cases; the
  gradient class is covered by the static gate
  (`node scripts/check-contrast.mjs`, which also runs in `pnpm test`).
- `not measured` — a gated route the audit could not sign in to see.

## 3. Triage

Exit 0 → post the summary on OOP-5816 and stop.

Exit 1 → for each failing route, file ONE issue:

- title: `a11y: <rule> on <route>`
- priority: `high` for a critical violation, `medium` for a serious one
- assignee: Claude Code (host), agentId
  `32a76d69-dd7f-4b4c-aadb-eb0cb71baf58`
- `blocks`: this routine's issue
- description: the route, the axe rule id, the target selector, the
  failure summary, and the exact command that reproduces it

A violation that is already claimed by an open issue is NOT a new
finding — comment the fresh result on that issue instead of filing a
second one. The same duplicate rule the readiness loop uses for its gap
ids (see `scripts/loop-triage.mjs`).

The audit cannot run → file a `priority=medium` issue named
`Accessibility gate could not run`, assigned to Claude Code (host), with
the command and its output.

## 4. Known exceptions

`scripts/a11y-audit.mjs` → `KNOWN_EXCEPTIONS`. Today there is one
entry: `html-has-lang` on the 404 document, tracked in OOP-6762 (the
root layout lives in the `[locale]` segment, so a URL that matches no
route never reaches a layout that owns `<html lang>`). The route is
still measured — every other rule on it still fails the run — and the
exception must be deleted when OOP-6762 is fixed.

## 5. Related gates

- `node scripts/check-contrast.mjs` — the static colour gate. It reads
  the source, so it judges what axe cannot: text over a gradient, and
  `:hover` states. Runs in `pnpm test`.
- `node scripts/mobile-audit.mjs` — the 360px overflow gate. Same
  route table, same sign-in, same exit-code contract.
- `node scripts/lighthouse-audit.mjs` — the performance / best-practices
  / SEO gate over four HTML pages, median of N samples.
