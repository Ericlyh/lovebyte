# Lovorithm — public beta launch checklist (OOP-4226)

This is the pre-deploy + first-day-on-call runbook for the Lovorithm
public beta. Run it from the top before every production deploy; the
on-call section is the quick reference for the first 24 hours after the
invite-only wave goes out.

**Audience:** the founder + the Claude Code (host) agent acting as
deploy operator.
**Scope:** Phase 10 / OOP-4226 only. Marketplace M-A..M-G and Phases
4–9 each have their own checklists in their closing issue comments.

---

## 1. Pre-deploy — env audit

Run `node scripts/check-env.mjs` (script lives in the repo at
`scripts/check-env.mjs` once Phase 10 closes; until then, the list
below is the manual check). Every value must be present in
**both** `.env.local` (for local dev) **and** the Vercel production
environment (`vercel env ls production`).

| Variable | Source | Required by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard → Project Settings → API | every page |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard → API Keys → publishable | server, browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard → API Keys → anon JWT | fallback only — see note |
| `SUPABASE_SECRET_KEY` | Dashboard → API Keys → `sb_secret_…` | server-only (waitlist, stripe webhook) |
| `RESEND_API_KEY` | https://resend.com/api-keys | transactional email |
| `RESEND_FROM` | verified sender in Resend | transactional email |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → API keys (live, not test) | checkout |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → endpoint signing secret | `/api/stripe/webhook` |

> **Note (OOP-4894):** The legacy `eyJ…service_role…` JWT is now
> 401-rejected at the Supabase gateway because "Disable service role
> JWT" was flipped in Dashboard → API. `sb_publishable_…` +
> `sb_secret_…` continue to work. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is
> kept only as a fallback in case a publishable key gets revoked
> without warning; treat its presence as a sanity check, not a
> requirement.

> **Phase 10 note:** No `TURNSTILE_SECRET_KEY` yet. The waitlist
> server action rate-limits by hashed IP + UA (one submission per
> hour per fingerprint). CAPTCHA goes in when we see real bot
> pressure; closed-beta traffic doesn't warrant it today.

---

## 2. Pre-deploy — DNS plan

Production hostname: `lovebyte-five.vercel.app` (Vercel-generated).
Future canonical: `lovebyte.app` (deferred; not yet acquired — see
BRAND.TS §DOMAIN).

**What the on-call needs to know:**

1. The Vercel project domain and any custom domains are visible at
   `vercel domains ls`. Confirm `lovebyte-five.vercel.app` is
   `production` and assigned to the current production deploy.
2. If a custom domain is added later, ensure the A / CNAME points at
   Vercel's load balancer (`76.76.21.21` / `cname.vercel-dns.com`)
   AND a 301 from the bare apex to `www` (or vice-versa, but pick
   one — the canonical hostname is in `src/lib/brand.ts` →
   `PRODUCTION_URL`).
3. **Domain decisions** for the launch are deferred per OOP-4211 §3:
   `lovebyte.app` is **not acquired**. The Vercel subdomain
   `lovebyte-five.vercel.app` is the live URL for the public beta.

---

## 3. Pre-deploy — Supabase backups

Run before each production deploy. Manual backup is cheap; Supabase
Pro retains 7 days of point-in-time recovery on its own, but a
pre-deploy snapshot means we can roll back cleanly even if we change
schema immediately after deploy.

```bash
# 1. List current schema migrations
ls supabase/migrations/

# 2. Compare against what's applied on the remote project
SUPABASE_PROJECT_REF=xsfbfqzmvjfxppvoxbze
curl -s -H "Authorization: Bearer $SUPABASEACCESSTOKEN_LOVEBYTE" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "select version from supabase_migrations.schema_migrations order by version desc limit 20"}'

# 3. Trigger a manual backup from Dashboard → Database → Backups
#    (Supabase CLI does not expose "take backup now" via API — the
#    Dashboard button is the sanctioned path; do not skip this step).
```

Schema applied as of OOP-4226:

- `0002_marketplace_v2.sql` (+ `_rls`, `_seed`)
- `0003_handle_history.sql`
- `0004_avatar_storage.sql`
- `0005_gift_like_count_fix.sql`
- `0006_stripe_connect.sql`
- `0007_gift_replies.sql`
- `0008_waitlist.sql` *(Phase 10)*
- `0009_incidents.sql` *(Phase 10)*

The launch deploy must apply `0008` and `0009` first if they are not
already on the remote. Use `node scripts/apply-migration.mjs
supabase/migrations/0008_waitlist.sql` (and the same for `0009`) —
that script is the PAT-driven path documented in
`lovebyte-pat-management-api-migration-seed`.

---

## 4. Pre-deploy — RLS verification

Three checks, each ~30 seconds:

```sql
-- A) Every public table has RLS enabled
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
-- rowsecurity should be `true` for every row.

-- B) No accidentally-permissive policies (anon can only do
--    what the marketplace design says it can do).
select schemaname, tablename, policyname, roles, cmd, qual
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- C) Phase 10 specific:
--    - public.waitlist: no INSERT policy for anon / authenticated
--    - public.incidents: SELECT policy `incidents_select_public`,
--      no INSERT/UPDATE/DELETE for anon / authenticated
select polname, polcmd, polroles::regrole[]
from pg_policy
where polrelid = 'public.waitlist'::regclass;
-- should show only service-role INSERT via the action (no anon rows).

select polname, polcmd, polroles::regrole[]
from pg_policy
where polrelid = 'public.incidents'::regclass;
-- should show exactly one row: `incidents_select_public`,
-- cmd = 'r' (SELECT).
```

If any of these returns the wrong shape, **stop the deploy** and open
a P1 issue tagged `security`.

---

## 5. Pre-deploy — OG preview checks

The marketplace gift pages render an Open Graph card on social
unfurls. The Phase 10 ships don't add new OG routes, but the
landing-page tag/headline is rendered on every share-link unfurl —
regression here hits every recipient's first impression.

```bash
# Local
pnpm dev
# Open http://localhost:3000/ in a browser, then in another tab:
curl -s http://localhost:3000/ | grep -E 'og:|twitter:'
# Expected:
#   <meta property="og:title" content="Lovorithm — Send a feeling, not just a gift." />
#   <meta property="og:description" content="..." />
#   <meta property="og:image" content="..." />
#   <meta name="twitter:card" content="..." />

# Production (after deploy)
PROD=https://lovebyte-five.vercel.app
curl -s "$PROD/" | grep -E 'og:|twitter:'
# Same expected output. If the build is missing og:* tags, the
# /api/og/* image route is also likely broken — check
# scripts/lighthouse-audit.mjs and the per-page audit log.
```

Social-share validator: paste a gift URL into
https://www.opengraph.xyz/ and verify the card preview renders the
right title, image, and description.

---

## 6. Pre-deploy — manual smoke

In order:

1. `pnpm typecheck && pnpm test && pnpm build` from a clean tree
   (no uncommitted changes under `src/`). The build gate (`vite build`
   plugin in `ui/vite.config.ts`) will fail the build if `tsc --noEmit`
   reports errors or i18n wiring is broken; that's the same gate that
   catches the "Can't find variable: t" outage pattern (see CLAUDE.md
   "Building the UI bundle"). Do **not** set `SKIP_BUILD_GATE=1`.
2. `pnpm dev`, hit `/`, `/status`, `/support`, `/privacy`, `/terms`,
   `/login`, `/signup`, `/browse`, `/g/demo`. Each should return 200
   with the language toggle visible at the top.
3. Submit the waitlist form (use a throwaway email). Verify:
   - The page returns to the "you're on the list" state.
   - `select count(*) from public.waitlist;` in SQL Editor shows the
     new row.
   - The service log shows `[waitlist] new signup …` (the placeholder
     line; Resend autoresponder wire-up is in the post-launch
     backlog).
4. Hit `/status` and verify "All systems operational" + "No incidents
   in the last 7 days." (When there are real incidents, the operator
   inserts via Dashboard → SQL Editor using the `insert into
   public.incidents …` shape from migration 0009.)
5. Hit `/support` and confirm all three mailto links open a compose
   window with the right address.

---

## 7. Deploy — Vercel production

```bash
# 1. Confirm the tree is clean (see lovebyte-board-done-without-commit).
cd /Users/molt/Developer/lovebyte
git status       # working tree clean
git log -1       # HEAD is the commit you expect to ship

# 2. Trigger a deploy via the Vercel API (paperclip-board pattern).
VERCEL_TOKEN=vcp_…31Xzzu   # from the team token, set in shell env
VERCEL_PROJECT_ID=prj_C9TIIEni96mFmt7WIF1gfh4Nq8dj
VERCEL_TEAM=team_svfqDOpCciGltUzHQEbOtpJe

curl -s -X POST \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v13/deployments?teamId=$VERCEL_TEAM&projectId=$VERCEL_PROJECT_ID" \
  -H "Content-Type: application/json" \
  -d '{"target":"production","gitSource":{"type":"git","ref":"main","repoId":1345574400}}'
# Save the `id` from the response.

# 3. Poll until readyState is READY (or FAILED). 60-second loop is fine.
DEPLOY_ID=…   # from above
while true; do
  STATE=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v13/deployments/$DEPLOY_ID?teamId=$VERCEL_TEAM" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('readyState'), d.get('errorCode',''))")
  echo "$(date -u +%H:%M:%S)  $STATE"
  case "$STATE" in
    READY*)  break ;;
    ERROR*|CANCELED*)  echo "DEPLOY FAILED: $STATE"; exit 1 ;;
  esac
  sleep 60
done

# 4. Verify alias assigned (per lovebyte-never-trust-prior-done-deploy).
curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v13/deployments/$DEPLOY_ID?teamId=$VERCEL_TEAM" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); \
    print('alias:', d.get('aliasAssigned'), 'url:', d.get('url'))"
```

After the deploy is `READY`, **smoke test against the live URL** (not
localhost):

```bash
PROD=https://lovebyte-five.vercel.app
for path in / /status /support /privacy /terms; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD$path")
  echo "$code  $PROD$path"
done
# All five should print `200`.
```

---

## 8. First 24 hours — monitoring

This is the **on-call rotation** for the first day of public beta.
There is one seat — the founder. The Claude Code (host) agent is the
backup for P1 incidents.

### What to watch

1. **Error rate** — Vercel Runtime Logs at
   https://vercel.com/lovebyte/logs. Filter on `level=error`. A
   sustained spike (>5 errors/min for >10 min) is a P1.
2. **LCP / Core Web Vitals** — Run `pnpm lh:prod` (alias for
   `node scripts/lh-prod.mjs`) once at T+2h and once at T+24h.
   Phase 9 closed with Lighthouse perf 97–99 and a11y 98–100, so a
   regression below 90 perf or 95 a11y is a P2.
3. **Supabase** — Dashboard → Logs → API. Watch for HTTP 5xx and
   `auth.uid()` RLS denials. The waitlist action explicitly does not
   use RLS for the insert, so any auth.uid() failure on waitlist is
   a real bug.
4. **Resend** — Dashboard → Logs. Watch for bounces (the share-link
   emails and the future waitlist autoresponder).
5. **Stripe** — Dashboard → Events. The webhook endpoint is
   `https://lovebyte-five.vercel.app/api/stripe/webhook`; if events
   pile up in `pending` or `failed`, the webhook secret rotated
   without the env var following.
6. **Support inbox** — `support@lovorithm.app`,
   `bugs@lovorithm.app`, `billing@lovorithm.app`. Monitor every
   two hours during the first 24h; reply within 1 business day
   (HK time) per the support page copy.

### Escalation

| Severity | Trigger | Response | Escalate to |
|---|---|---|---|
| P1 | Outage, payment failure, data loss | Acknowledge in 5 min, fix or rollback in 30 min | Founder |
| P2 | Degraded UX, broken flow without data loss | Acknowledge in 30 min, fix same business day | Claude Code (host) |
| P3 | Cosmetic / non-blocking | Acknowledge in 1 business day, fix in next phase | Backlog |

### Rollback

Vercel instant rollback:

```bash
# Promote the previous production deploy to production.
curl -s -X POST -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v13/deployments/$PREVIOUS_DEPLOY_ID/promote?teamId=$VERCEL_TEAM" \
  -H "Content-Type: application/json" -d '{}'
```

This re-points the alias to the previous build in ~30 seconds. Schema
changes (Phase 10 added `waitlist` and `incidents`) are NOT rolled
back automatically; a rollback for a migration-related incident also
needs a forward-fix migration that undoes the schema delta.

---

## 9. Post-launch follow-ups (not blocking the launch)

These are the known gaps from Phase 10 — listed here so they don't
get lost, NOT pre-launch work:

1. **Waitlist autoresponder email** — the action currently logs the
   signup but does not call Resend. Wire `sendWaitlistEmail()` in
   `src/lib/email.ts` (mirror `sendShareEmail`'s shape, simpler
   copy: "you're on the list, here's what to expect"). The
   RESEND_API_KEY env var is already required.
2. **Turnstile / hCaptcha gate** — add the widget to
   `src/components/WaitlistForm.tsx` once TURNSTILE_SECRET_KEY is
   configured. Until then, the IP+UA rate-limit is the placeholder
   (see `src/lib/actions/waitlist.ts` "Out of scope" comment).
3. **Status-page admin route** — operators currently insert
   incidents via the Supabase SQL Editor. A `POST /api/incidents`
   route would let on-call log an incident without leaving Slack.
   Skip until the rotation grows past one seat.
4. **Lovorithm → Lovorithm brand consolidation** — `src/lib/brand.ts`
   keeps `STORAGE_BUCKET`, `PRODUCTION_URL`, and `DOMAIN` on the
   LoveByte-era values because each requires external coordination
   (bucket migration, Vercel rename, domain acquisition). Track
   these under a follow-up issue when the rename becomes blocking.

---

*Phase 10 / OOP-4226. Run this from the top before each production
deploy.*
