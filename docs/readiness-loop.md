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
- Each critical route is served **in full** within `GATE_ROUTE_MAX_MS`
  (default 4000ms). The gate reads the response body, not just the
  headers: `/browse` once answered 200 with its first byte in 350ms and
  its markup 6.5s later, so a visitor saw a blank white page while a
  database read timed out. A slow route is a failed route.
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

## 2. Triage the gaps against the board

```bash
node scripts/readiness-gate.mjs --json-file /tmp/gate.json
node scripts/loop-triage.mjs /tmp/gate.json
```

The gate is honest, which means a gap that is caused by something you
cannot fix comes back every single morning. Triage separates the two
kinds:

- **`already-tracked`** — an open issue already claims this gap. Post
  the current gate result as a comment on that issue and move on. If
  the tracking issue is `blocked`, do **not** try to fix the gap and do
  **not** file a new issue — the cause is with a human.
- **`new`** — nothing tracks this gap. File an issue for it, and put
  `gap:<id>` in the description so the next firing recognises it.

An issue claims a gap by containing the marker `gap:<id>` in its title
or description. The gate's gap ids are stable, so the marker is stable:
`data-status-unknown`, `data-catalog-empty`,
`lighthouse-browse-perf`, `http-browse-slow`, `og-missing-og-image`,
and so on. Today `OOP-6154` claims the two data-layer gaps.

This step exists so the loop does not fill the board with one duplicate
issue per gap per day — a loop that spams is a loop nobody reads.

## 3. Pick the top gap

Order by blast radius, not by how easy it is to fix:

1. Any critical route returning a non-200 (an outage for a user).
2. Any route returning 200 but rendering an empty/error state (e.g. the
   catalog feed returns `{"gifts":[]}` because the data layer is down —
   this is a *silent* failure and is worse than a 500).
3. Any critical route served slower than `GATE_ROUTE_MAX_MS` — a route
   that takes 7 seconds to produce its markup is unusable even though
   it answers 200.
4. Lighthouse perf < 95 or a11y < 98.
5. Missing `og:`/`twitter:` metadata.

Skip anything triage marked `already-tracked` — it is not a gap you
can close this firing. Exactly **one** gap per firing. The loop is a
loop, not a batch.

## 4. Fix it

- Reproduce locally first (`pnpm dev`), then fix.
- `pnpm typecheck && pnpm test` must be green before you commit.
- Commit with a message that names the gate line that was red.

## 5. Verify and ship

```bash
git push origin main            # triggers the Vercel GitHub deploy
# then wait for the deployment to go READY and re-run:
node scripts/readiness-gate.mjs
```

The deploy is verified, never assumed: check `readyState === 'READY'`
and `aliasAssigned` on the deployment object before re-running the gate.

## 6. Publish the result

Post the run summary as a comment on the triage target (OOP-5816):

```
**Loop run <date>.**
- Gate: PASS / FAIL (<n> gaps)
- Fixed: <what>
- Verified: <command + output>
- Remaining: <list>
```

Also comment the result on every issue triage marked `already-tracked`,
so the tracker issue carries the current state of its gap.

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
- **A slow dependency is a failure, not a slow success.** `/browse` once
  held its whole body open for 6.5 seconds while a database read sat in
  a client-library retry backoff, and the visitor saw a blank page. Fix
  the failure mode at the source — `src/lib/supabase/net.ts` caps the
  cost of an unreachable host — rather than the symptom.
