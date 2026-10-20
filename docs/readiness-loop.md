# Launch-readiness loop — executor spec

Paperclip routine **Paperclip: Lovorithm Launch-Readiness Loop**
(triage target: OOP-5816). This file is the executor's spec: what a
single firing of the routine does, in order, and what "done" means.

The companion runbook for humans is `docs/launch-checklist.md`. The
difference: the checklist is run *before a deploy by a human*, this
loop is run *daily by an agent with no human present*.

---

## 0. Preflight

```bash
cd /Users/molt/Developer/lovebyte
git log --oneline -5 origin/main && git status --short
```

If the tree is dirty or `origin/main` is ahead, do not start work on
top of it — pull first (`git pull --ff-only origin main`). Never build
from a tree that is not committed; the Vercel deploy ships the pushed
commit, so an uncommitted fix is invisible to production.

## 1. Run the objective gate

```bash
node scripts/readiness-gate.mjs
```

Exit codes:

| code | meaning | what to do |
|------|---------|-----------|
| 0 | ready to serve | go to step 5 (publish the clean result) |
| 1 | gaps found | go to step 2 (fix the top gap) |
| 2 | probe could not run (no Chrome / no network) | file a `priority=medium` issue; stop |

The gate checks, against `https://lovebyte-five.vercel.app`:

- HTTP 200 on `/`, `/browse`, `/g/demo`, `/status`, `/support`,
  `/privacy`, `/terms`, `/login`, `/signup`
- The **data layer** is live (OOP-6154): `/status` must emit
  `data-status-state="operational"` — that marker is only rendered when
  the incident read actually succeeded, and `"unknown"` means the read
  failed — and `/api/catalog/feed` must serve at least one gift
  (`GATE_CATALOG_MIN`, default 1). HTTP 200 alone is not readiness: with
  a dead Supabase host every route still answered 200 over an empty
  catalog.
- Lighthouse performance ≥ 95 and accessibility ≥ 98 on `/`, `/g/demo`,
  `/browse`
- `og:title`, `og:description`, `twitter:card` present on `/`

`og:image` is currently a **warning**, not a failure — no static OG
asset ships yet. It is tracked as its own issue.

## 2. Pick the top gap

Order by blast radius, not by how easy it is to fix:

1. Any critical route returning a non-200 (an outage for a user).
2. Any route returning 200 but rendering an empty/error state (e.g. the
   catalog feed returns `{"gifts":[]}` because the data layer is down —
   this is a *silent* failure and is worse than a 500).
3. Lighthouse perf < 95 or a11y < 98.
4. Missing `og:`/`twitter:` metadata.

Exactly **one** gap per firing. The loop is a loop, not a batch.

## 3. Fix it

- Reproduce locally first (`pnpm dev`), then fix.
- `pnpm typecheck && pnpm test` must be green before you commit.
- Commit with a message that names the gate line that was red.

## 4. Verify and ship

```bash
git push origin main            # triggers the Vercel GitHub deploy
# then wait for the deployment to go READY and re-run:
node scripts/readiness-gate.mjs
```

The deploy is verified, never assumed: check `readyState === 'READY'`
and `aliasAssigned` on the deployment object before re-running the gate.

## 5. Publish the result

Post the run summary as a comment on the triage target (OOP-5816):

```
**Loop run <date>.**
- Gate: PASS / FAIL (<n> gaps)
- Fixed: <what>
- Verified: <command + output>
- Remaining: <list>
```

Also update the routine's own state on the triage issue so the next
firing knows what was already attempted.

---

## Hard rules

- **One gap per firing.** If two gaps appear, file the second as an
  issue instead of fixing both.
- **Never set `SKIP_BUILD_GATE=1`.** The build gate is the thing that
  catches a broken bundle before it reaches users.
- **Never deploy from an uncommitted tree.** Push, then verify the
  deployment, then re-run the gate.
- **The data layer is the first thing to check.** If the Supabase host
  does not resolve, every DB-backed route degrades to an empty state
  rather than an error. An empty catalog is a P1, not a quiet success.
