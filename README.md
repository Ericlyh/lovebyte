# LoveByte — Web MVP

Send a feeling, not just a gift. The implementation of the LoveByte MVP
that was scoped in OOP-4206 (Study) and kicked off in OOP-4211.

<!-- 2026-09-02: no-op to retrigger Vercel deploy (OOP-4267). main was already
     at 2996d21 with the OOP-4274 handle-check fixes — webhook had stopped firing. -->

## Source of truth — the design pack

All design artifacts live in the Paperclip project workspace, not in this
repo:

- `design/01-brand/` — palette tokens (Warm Romantic default; Soft Pastel
  and Modern Minimal alternatives)
- `design/02-ia/` — screen flow + App Router route map
- `design/03-mockups/` — 9 HTML+CSS mockups + `shared-tokens.css`
- `design/04-architecture/architecture.md` — schema, routes, RLS, deploy plan

The palettes are mirrored into `src/styles/palettes/` so the app can
`@import` them without crossing the workspace boundary. **When a palette
is edited in `design/01-brand/`, mirror the change here.**

## Stack (locked from Study, with one drift noted)

| Concern | Locked | Actually using | Notes |
|---|---|---|---|
| Framework | Next.js 15 App Router | **Next.js 16.3.2** | `create-next-app@latest` is now 16. Major change: `middleware.ts` → `proxy.ts`. Documented in `src/proxy.ts`. |
| CSS | Tailwind | **Tailwind 4** | CSS-first config via `@theme inline` in `src/app/globals.css`. No `tailwind.config.ts` — Tailwind 4's modern path. |
| i18n | `next-intl` middleware | `next-intl@4.13.7` | `localePrefix: 'never'` so `/g/[token]` works for any recipient regardless of sender language. Message bundles live at `src/messages/{en,zh-Hant}.json`. |
| Auth/DB | Supabase | `@supabase/ssr@0.12.5` | Client + Server scaffolds at `src/lib/supabase/`. Database types not generated yet — pending live project. |
| Validation | Zod | `zod@4.4.3` | For `gifts.payload` schema checks per gift type. |
| Hosting | Vercel | `vercel` CLI installed globally (npm prefix `/Users/molt/.hermes/node`) | `vercel deploy` requires `vercel login` + team selection first. |

The drift (Next 15 → 16, Tailwind 3 → 4) is the modern default of
`create-next-app@latest`. The architecture's intent — App Router,
Server Components, ISR, Edge — is preserved. Reverting is straightforward
if a blocker surfaces.

## Local dev

```bash
cd ~/Developer/lovebyte
pnpm install
cp .env.example .env.local       # then fill in real Supabase keys
pnpm dev                         # http://localhost:3000
pnpm typecheck && pnpm build     # CI gate
```

## Deploy

Blocked on user-provided credentials. See OOP-4211 blockers 1–3.

```bash
vercel login                     # one-time
vercel link                      # bind to lovebyte project
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SECRET_KEY production
pnpm build && vercel deploy --prod
```

## Open-design mirror

When new components ship in `src/`, mirror them back to the open-design
`lovebyte` project so the design pack and the app stay in sync:

```bash
# one-time setup
od projects use lovebyte

# per-component
od artifacts create \
  --name "lb-card" \
  --kind component \
  --file src/components/lb-card.tsx
```

The mockups already mirrored are browseable in the open-design UI at
`http://127.0.0.1:7456/`.

## Status

- ✅ Phase 1 step 1: scaffold + tokens + i18n + Supabase schema
- ⛔ Blocked on: Vercel team, Supabase Cloud project, domain decision

See the latest comment on OOP-4211 for the current `ask_user_questions`
interaction.
