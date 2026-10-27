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

Run `node scripts/check-env.mjs`. It audits `.env.local` and the Vercel
production environment, prints presence only (never a value), and exits
non-zero while anything is missing. Every value must be present in
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
| `INCIDENT_ADMIN_TOKEN` | any random string ≥ 32 chars | `/api/incidents` (status-page admin) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare → Turnstile → widget site key | waitlist CAPTCHA — **optional**, see the Phase 10 note below |
| `TURNSTILE_SECRET_KEY` | Cloudflare → Turnstile → widget secret key | waitlist CAPTCHA — **optional**, server-only |

> **Note (OOP-6168):** `RESEND_FROM` must be a sender domain that is
> **verified** in Resend. `lovebyte.app` is not acquired (§2), so until
> it is, use a domain the team actually controls — Resend's onboarding
> domain (`onboarding@resend.dev`) only delivers to the account owner's
> own inbox, which is enough for a smoke test and NOT enough for real
> customers. There is no in-between: an unverified `RESEND_FROM` makes
> `deliverEmail` refuse to send at all.

### 1.1 — Stripe account setup (beyond the keys)

Copying the two keys is necessary but **not sufficient**. The money path
is a Connect destination charge (`payment_intent_data.transfer_data.
destination` in `src/lib/actions/checkout.ts`), so three more things must
be true in the Stripe account:

1. **Connect must be enabled** for the platform account
   (Stripe → Settings → Connect). Without it, `stripe.accounts.create`
   and every destination charge fail with an opaque permissions error.
2. **The webhook endpoint must subscribe to THREE events**, not one:

   | Event | What breaks without it |
   |---|---|
   | `checkout.session.completed` | a paid order is never turned into a gift — the customer pays and nothing is fulfilled |
   | `account.updated` | `profiles.stripe_charges_enabled` is never set to true, so **every** listing is refused with "This creator is not set up to receive payouts yet" |
   | `charge.refunded` | refunds never reconcile — the purchase row keeps `status='paid'` |

   Endpoint URL: `https://lovorithm.vercel.app/api/stripe/webhook`.
   The signing secret (`whsec_…`) is shown when the endpoint is created.

3. **At least one creator must complete Express onboarding**
   (`/onboarding` on the site, which calls `stripe.accounts.create` +
   `stripe.accountLinks.create`). Until one creator finishes it, no
   listing can be sold — `stripe_charges_enabled` is false, and checkout
   refuses before it ever reaches Stripe.

> **Note (OOP-6168):** the readiness gate cannot see any of this. It
> checks that the webhook route rejects a bogus signature (both Stripe
> vars present and the SDK usable) and that the required env vars are
> deployed. Connect, the event subscriptions, and creator onboarding
> are account state, not deploy state — check them by hand in the
> Stripe dashboard after the keys land.


> **Note (OOP-4894):** The legacy `eyJ…service_role…` JWT is now
> 401-rejected at the Supabase gateway because "Disable service role
> JWT" was flipped in Dashboard → API. `sb_publishable_…` +
> `sb_secret_…` continue to work. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is
> kept only as a fallback in case a publishable key gets revoked
> without warning; treat its presence as a sanity check, not a
> requirement.

> **Phase 10 note (OOP-6161):** The Turnstile gate is **implemented but
> dormant** — it is off until `TURNSTILE_SECRET_KEY` is set, and the
> waitlist server action rate-limits by hashed IP + UA (one submission
> per hour per fingerprint) as the second layer. CAPTCHA goes in when
> we see real bot pressure; closed-beta traffic doesn't warrant it
> today.
>
> To turn it on (~10 min, no code change):
>
> 1. Create a Turnstile widget for the production hostnames
>    (`lovorithm.vercel.app` and `lovebyte-five.vercel.app`) at
>    https://dash.cloudflare.com → Turnstile → Add widget. Cloudflare
>    will not verify a token for a hostname that is not on the widget.
> 2. `vercel env add NEXT_PUBLIC_TURNSTILE_SITE_KEY production` (the
>    site key — public, ends in `0x…`) and
>    `vercel env add TURNSTILE_SECRET_KEY production` (the secret key
>    — server-only).
> 3. Redeploy. The widget renders and the server starts verifying.
>
> The gate fails **closed**: once the secret key is set, a submission
> with no token, an invalid token, or an unreachable Cloudflare is
> rejected and no row is inserted. Do not set the secret key without
> the site key — the widget would not render and every submission
> would be rejected.

---

## 2. Pre-deploy — DNS plan

Production hostname: `lovorithm.vercel.app` (Vercel-generated).
Future canonical: `lovebyte.app` (deferred; not yet acquired — see
BRAND.TS §DOMAIN).

**What the on-call needs to know:**

1. The Vercel project domain and any custom domains are visible at
   `vercel domains ls`. Confirm `lovorithm.vercel.app` is
   `production` and assigned to the current production deploy.
2. If a custom domain is added later, ensure the A / CNAME points at
   Vercel's load balancer (`76.76.21.21` / `cname.vercel-dns.com`)
   AND a 301 from the bare apex to `www` (or vice-versa, but pick
   one — the canonical hostname is in `src/lib/brand.ts` →
   `PRODUCTION_URL`).
3. **Domain decisions** for the launch are deferred per OOP-4211 §3:
   `lovebyte.app` is **not acquired**. The Vercel subdomain
   `lovorithm.vercel.app` is the live URL for the public beta.

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
PROD=https://lovorithm.vercel.app
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
   - The service log shows `[waitlist] new signup …`.
   - The autoresponder arrives (OOP-6156): check Resend → Logs for the
     "You're on the Lovorithm waitlist." message. In dev / test a
     missing `RESEND_API_KEY` falls back to a `[email/stub] waitlist
     email` log line and no email goes out; in **production** it fails
     loud instead — the send returns an error and the action logs it, so
     a missing key shows up as an error in the logs rather than a
     signup that silently never got an email (OOP-6168).
4. Hit `/status` and verify "All systems operational" + "No incidents
   in the last 7 days." (When there are real incidents, the operator
   logs them with the admin route — OOP-6156:

   ```bash
   curl -X POST -H "Authorization: Bearer $INCIDENT_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"severity":"degraded","title":"Elevated 502s on /create","body":"Looking into it."}' \
     https://lovorithm.vercel.app/api/incidents
   ```

   Close it with `PATCH /api/incidents/<id>` and `{"status":"resolved"}`.
   The token is the `INCIDENT_ADMIN_TOKEN` env var; if it is unset the
   route returns 503 and writes are disabled.)
5. Hit `/support` and confirm all three mailto links open a compose
   window with the right address.

---

## 7. Deploy — Vercel production

```bash
# 1. Confirm the tree is clean (see lovebyte-board-done-without-commit).
cd /Users/molt/Developer/lovebyte
git status       # working tree clean
git log -1       # HEAD is the commit you expect to ship

# 2. Deploy with the Vercel CLI — it inherits the project env vars.
#
#    Do NOT use the manual `POST /v13/deployments` call for a deploy
#    that has to see env vars. A deployment created that way ships
#    WITHOUT the project's env bindings: the dashboard shows
#    RESEND_API_KEY / STRIPE_SECRET_KEY / … as set, the deployment runs,
#    and the app still behaves as if they were never configured (email
#    and checkout stay dead). Observed 2026-10-04 on
#    dpl_7pmcfgS8VNArKnzjA8fEwBAHY249, which also shipped with a
#    NEXT_PUBLIC_SUPABASE_URL that did not match the project env.
#
#    The CLI ships the LOCAL tree and does not push to git — push
#    separately if the repo has to be in sync.
cd /Users/molt/Developer/lovebyte
vercel deploy --prod --yes --global-config /Users/molt/.vercel
# Save the deployment id / URL from the output.

# 3. Poll until readyState is READY (or FAILED). 60-second loop is fine.
VERCEL_TOKEN=vcp_…31Xzzu   # from the team token, set in shell env
VERCEL_PROJECT_ID=prj_C9TIIEni96mFmt7WIF1gfh4Nq8dj
VERCEL_TEAM=team_svfqDOpCciGltUzHQEbOtpJe

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
PROD=https://lovorithm.vercel.app
for path in / /status /support /privacy /terms; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$PROD$path")
  echo "$code  $PROD$path"
done
# All five should print `200`.

# Env readiness — names of missing required vars, never values.
curl -s "$PROD/api/readiness"
# {"ok":true,"missing":[]} once every var is deployed.

# Money path — a bogus signature must be rejected with 400.
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$PROD/api/stripe/webhook" \
  -H "Content-Type: application/json" \
  -H "stripe-signature: t=1,v1=probe" \
  -d '{"type":"checkout.session.completed"}'
# 400 = both Stripe vars are deployed and the SDK is usable.
# 500 = STRIPE_WEBHOOK_SECRET missing.  503 = STRIPE_SECRET_KEY missing.
```

---

## 8. First 24 hours — monitoring

This is the **on-call rotation** for the first day of public beta.
There is one seat — the founder. The Claude Code (host) agent is the
backup for P1 incidents.

### What to watch

1. **Error rate** — Vercel Runtime Logs at
   https://vercel.com/lovorithm/logs. Filter on `level=error`. A
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
   emails and the waitlist autoresponder).
5. **Stripe** — Dashboard → Events. The webhook endpoint is
   `https://lovorithm.vercel.app/api/stripe/webhook`; if events
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

The Phase 10 gaps used to live here. They are tracked as issues with
named owners now — this section is a pointer, not the tracker. If you
find a new gap, **file an issue**; don't add it to this list.

| Issue | Item | Owner |
|---|---|---|
| OOP-6161 | Turnstile / hCaptcha gate on the waitlist form | Claude Code (host) — gate **built and dormant**; switch on with `TURNSTILE_SECRET_KEY` when bot pressure appears (§1) |
| OOP-6162 | Lovorithm infra rename — Vercel project + Storage bucket | Claude Code (host) — Vercel leg done; Storage leg blocked on OOP-6154 |
| OOP-6163 | Acquire the canonical production domain | board owner (human) |
| OOP-6164 | Provision the missing production env vars (RESEND, STRIPE) | board owner (human) |

Shipped in OOP-6156 (no longer a gap):

- **Waitlist autoresponder email** — `sendWaitlistEmail()` in
  `src/lib/email.ts`, called by `joinWaitlistAction` after the insert.
  Needs `RESEND_API_KEY` + `RESEND_FROM` to actually send (OOP-6164).
- **Status-page admin route** — `POST /api/incidents` and
  `PATCH /api/incidents/[id]`, bearer-token auth, service-role writes.
  See §6 step 4 for the curl.

---

*Phase 10 / OOP-4226. Run this from the top before each production
deploy.*
