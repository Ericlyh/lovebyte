# Lovorithm — user & business flow reference

**Issue**: OOP-5689
**Scope**: every user-facing and business flow on the Lovorithm (a.k.a. LoveByte) web app, MVP through public beta.
**Audience**: anyone shipping to this codebase, including humans and agents, who needs to know what exists today, what crosses which boundary, and where to look before changing anything.
**Pair with**: `docs/launch-checklist.md` (deploy ops) and `scratch/architecture.md` (planned architecture).

> **How to use this doc.** Read it top-to-bottom on first contact. After that, use it as a lookup: pick the flow you are touching, read its *Pre-conditions* and *Failure modes* sections before editing. If a flow is missing, add it here in the same shape — the doc is load-bearing for the cross-check pattern described in OOP-5689.

---

## 0. Actors (every flow names an actor)

| Actor | Identity | What they can do |
|---|---|---|
| **Visitor** | no session | view landing, browse marketplace, read public listings, open `/g/[token]` |
| **Pending user** | signed up, email not verified | everything a signed-in user can do *except* upload media and checkout (M-A: storage and Stripe are post-verification) |
| **Signed-in user** | email verified | read + comment + like + follow; can become a creator by publishing a gift |
| **Creator** | signed-in user who has published ≥1 gift | publish / unpublish; receive replies on their listings; receive payouts (Stripe Connect) |
| **Buyer** | signed-in user who has paid for ≥1 gift | owns purchase history + share tokens; can choose `send_to_recipient` or `buyer_shares` |
| **Recipient** | anyone with a `/g/[token]` link | open + reply; no account required |
| **Admin** | service-role client (humans + ops scripts) | stripe webhook + incidents writes; otherwise RLS-forbidden |

> **Verified-vs-pending fork.** Email confirmation is required before storage upload and Stripe checkout (M-A). The `signUpAction` pre-check distinguishes *verified* (redirect to sign-in) from *pending* (auto-resend confirmation) — see [[#1.1 Sign up]].

---

## 1. Auth & onboarding

Entry: `/login`, `/signup`, `/onboarding`, `/signup/check-email`, `/signup/check-email?status=verified`.
Source files: `src/app/(login|signup|onboarding)/`, `src/lib/actions/auth.ts`, `src/lib/profiles/handle.ts`.
Constants: `HANDLE_MIN_LENGTH=3`, `HANDLE_MAX_LENGTH=20`, regex `^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$`, bio ≤600, password 8–72.

### 1.1 Sign up
- **Actor**: Visitor.
- **Entry**: `/signup`. Form posts to `signUpAction(formData)` with email + password + display_name + handle.
- **Pre-checks** (throw-safe — wrap any throw in try/catch and return `{ ok:false, error }`):
  1. **Email availability** via `useEmailAvailability` (debounced 8 s, OOP-4274 follow-up). The `checkEmailAction` server call distinguishes verified vs pending.
  2. **Handle availability** via `useHandleAvailability` (debounced 4 s). Throws from `checkHandleAction` are caught (OOP-4274); the server-side `handle_history` RPC is the canonical truth.
- **Side effects**:
  - Inserts `auth.users` row with `raw_user_meta_data={handle, display_name, ...}`.
  - Trigger `handle_new_user` seeds `profiles.handle` from metadata, falling back to email-prefix/hash on conflict (`0002_marketplace_v2.sql`).
  - Fires Supabase confirmation email; with email-confirm-on, session is `null` until verified.
- **Outcome**: redirect to `/signup/check-email` (pending) or `/onboarding` (verified).
- **Failure modes**:
  - Existing verified email → `lookupEmail` returns the user → bounce to `/login`.
  - Existing pending email → auto-call `resend()` and show the same `/signup/check-email` page.
  - Pre-check missing on a stale UI → Supabase returns `user_already_exists`; the action returns a friendly error rather than silently succeeding (OOP-5379: `resend` 200s on verified users; pre-check avoids the lie).
- **See also**: [[lovebyte-signup-verified-vs-pending]], [[lovebyte-handle-check-throw-safe]], [[lovebyte-signup-pre-submit-email-state]].

### 1.2 Log in
- **Actor**: Visitor.
- **Entry**: `/login?next=…`. Form posts to `signInAction(formData)`.
- **Pre-checks**: handle/email format (Zod), password length.
- **Outcome**: `redirect('/')` on success (anon and authed navs both render in `Nav.tsx`, OOP-5390). On failure: `{ ok:false, error }` rendered via `useActionState`.
- **Failure modes**: Supabase "Invalid login credentials" → surface as a single error; do not distinguish email-not-found from wrong-password (information leak).

### 1.3 Resend confirmation
- **Actor**: Pending user.
- **Entry**: `/signup/check-email` "Resend" button → `resendConfirmationAction`.
- **Pre-check**: `lookupEmail(email)` first; if already verified, redirect to `/login` instead of silently 200-ing on `/auth/v1/resend` (OOP-5379).

### 1.4 Onboarding
- **Actor**: Pending or freshly-verified user.
- **Entry**: `/onboarding`. Form posts to `upsertProfileAction(formData)`.
- **Fields**: handle (kebab-case 3–20), display_name (1–60), bio (≤600), links (one URL per line, http(s) only, JSON array), avatar (Storage upload via `/api/upload/avatar`).
- **Pre-checks**:
  - Handle format via `validateHandle`; canonical regex shared with the `handle_history` RPC.
  - Avatar bucket `lovebyte-media` private; uploaded to `avatars/<user-id>/…`; server returns a `gift_media` row (OOP-4310).
- **Outcome**: `redirect('/home')`.

### 1.5 Sign out
- **Entry**: nav link → `signOutAction` → Supabase cookie cleared → `redirect('/')`.

### 1.6 Session probe
- **Endpoint**: `GET /api/me` (anon-tolerant, `Cache-Control: no-store`).
- **Returns**: `{ authed: boolean, userId?: string }`. Used by client components to gate optimistic UI ("Sign in to like" vs the authed variant) without a server round-trip through a page boundary.

---

## 2. Marketplace — discovery

Entry: `/browse`, `/l/[giftId]`, `/u/[handle]`, `/u/me`.
Source files: `src/app/browse/`, `src/app/l/[giftId]/`, `src/app/u/[handle]/`, `src/app/api/catalog/{feed,search}/`, `src/lib/catalog.ts`, `src/lib/actions/(like|comments|giftReplies).ts`, `src/app/api/comment-reports/`.
Constants: comment body 1–1000, reply body 1–1000, fee bps 500–10000, `LOVEBYTE_MIN_FEE_BPS=500`, `DEFAULT=1000` (10%).

### 2.1 Browse the catalog
- **Actor**: Visitor (lists are public) or any signed-in user (likes + comments enabled).
- **Entry**: `/browse`. Initial server render reads `getCatalogFeed`/`searchCatalog` in `src/lib/catalog.ts`; client-side filtering + infinite scroll go through the JSON APIs:
  - `GET /api/catalog/feed?category=&priceTier=&creator=&sort=&cursor=` → `{ gifts: CatalogGift[], nextCursor }`. Reads `gifts_select_public_listed` (`cache: 'no-store'`).
  - `GET /api/catalog/search?q=&limit=` → PostgREST FTS via `search_tsv` (GIN index `gifts_search_tsv_idx`).
- **Index used**: `gifts_listed_published_idx` (`is_listed=true AND deleted_at IS NULL`, ordered `published_at desc`).
- **Filters**: category (5 enum values), price band (free / under-X / X+), search via `search_tsv` GIN (`setweight('simple',title)='A' || setweight('simple',description)='B'`).
- **Card data per row**: cover media (signed URL via `profiles_public`-safe join), price, category, like count (cached `gifts.like_count` from M-D fix in `0005_gift_like_count_fix.sql`), creator handle.
- **Failure modes**: empty result set → "No gifts match yet" empty state (i18n key `Browse.empty`). Stale search index → reads always-on generated column; no drift.

### 2.2 Listing detail
- **Actor**: Visitor (read); signed-in user (comment, like, reply, follow, purchase CTA); creator of this listing (edit, unpublish, prune replies).
- **Entry**: `/l/[giftId]`. RLS policy `gifts_select_listed_published` (anon-readable when listed+not-deleted) gates the row; creator sees their own unlisted drafts through `gifts_select_own`.
- **Components**:
  - `<ListingHero>`: cover, title, price, description, creator chip.
  - `<CreatorCard>`: handle + display_name + follow button (`followCreatorAction` toggling `creator_follows`).
  - `<LikeButton>`: `toggleLikeAction`; anon click → "Sign in to like" surface.
  - `<CommentComposer>` + `<CommentThread>`: `createCommentAction` / `deleteCommentAction`. Optimistic UI; soft-delete via `deleted_at`.
  - `<ReplyThread>` (M-G, OOP-4900): `createGiftReplyAction` / `deleteGiftReplyAction`. Threaded; creator can prune the whole thread (RLS `gift_replies_delete_own_or_creator`).
  - `<ReportButton>` → `/api/comment-reports` REST route (separate from server actions because reports don't need optimistic UI).
  - `<PurchaseCard>` → CTA to `/checkout/[giftId]` (see [[#4 Checkout & purchase]]).
- **Failure modes**: gift `deleted_at IS NOT NULL` → `not-found.tsx`. RLS deny on unlisted gift → same `not-found.tsx` (no info leak).

### 2.3 Creator profile
- **Actor**: Visitor.
- **Entry**: `/u/[handle]`. Looks up via `profiles_handle_uidx` (handle is the public id).
- **Tabs / sections**: hero (avatar + bio + links + follow button + follower count from `creator_follows`), collection (gifts `is_listed=true AND deleted_at IS NULL`, ordered `published_at desc`, filtered by handle via `gifts_creator_listed_idx`).
- **Failure modes**: unknown handle → `not-found.tsx`. CSS coverage required — see [[lovebyte-profile-css-missing-m-b]] (any new `className=` must have a matching rule; verify by `curl`-ing the deployed CSS).

### 2.4 Like / follow
- **Actor**: signed-in user.
- **Like**: `toggleLikeAction({ giftId })` → idempotent insert/delete on `gift_likes`; returns `{ liked, likeCount }`. RLS scopes to `auth.uid() = profile_id`. After insert/delete the action calls RPC `gift_like_count(gift_id)` to keep the cached `gifts.like_count` in step (fallback to ±1 if RPC fails).
- **Follow**: REST endpoints (not server actions — they need optimistic UI but no auth wiring change between insert/delete):
  - `POST /api/creator-follows { creator_id }` → upsert on `creator_follows (follower_id, creator_id)`; 422 on self-follow (`CHECK follower_id <> creator_id`).
  - `DELETE /api/creator-follows/[creatorId]` → delete own row.
- **Anon behaviour**: `useTransition` calls return `unauthenticated`; the client renders "Sign in to like / follow" rather than redirecting (which would tear down the listing page).

---

## 3. Gift creation (creator side)

Entry: `/create`, `/create/{memory-cards,dragdrop-puzzle,quiz,multimedia-collage}`, `/create/[giftId]/finish`.
Source files: `src/app/create/`, `src/lib/actions/(draft|memoryCards|dragdropPuzzle|quiz|multimediaCollage|publish).ts`, `src/features/<type>/schemas.ts`, `src/app/api/upload/{media,photo}`.
Constants: title ≤100, description ≤500, payload shape per `schemas.ts`, media: photo ≤5 MB, video ≤50 MB, audio ≤25 MB (per-kind MIME + size guards in `0007`-era `/api/upload/media`).

### 3.1 Pick type
- **Entry**: `/create` (auth-gated; redirects to `/login?next=/create` if anon).
- **Form**: `<CreateDraftForm>` → `createDraftGiftAction(formData)` (`src/lib/actions/draft.ts`).
- **Routing** (OOP-5438 load-bearing):
  - 4 builder-having types (`memory_cards`, `dragdrop_puzzle`, `quiz`, `multimedia_collage`) → `redirect('/create/<type>')` immediately. The builder's own `save*DraftAction` writes the `gifts` + `shares` rows.
  - `animated_letter` (no sender-side builder yet) → empty-payload draft + redirect to `/create/[id]/finish` (legacy MVP path; `publishToMarketplaceAction` rejects empty payloads).
- **Failure modes**: title empty → Zod fail. Empty-payload publish attempt → `publishToMarketplaceAction` rejects with "This gift has no content yet…".

### 3.2 Build a gift (per type)

Each builder folder under `src/features/<type>/` exposes:
- **Builder page** (`/create/<type>`) — sender-side authoring UI.
- **Recipient view** (mounted by `/g/[token]/open` when `gifts.type = <type>`) — public render.
- **`schemas.ts`** — Zod schema for `gifts.payload`. **Canonical location is `src/lib/gifts/schemas.ts`** (re-exported from features, OOP-4219 architecture §6 note).

The 4 builders and their payload shapes (Zod bounds, in `src/lib/gifts/schemas.ts`):

| Type | Payload shape | Phase / OOP | Media |
|---|---|---|---|
| `memory_cards` | `{ pairs: [{photo_url, caption}] (3–12, photos unique), difficulty: 'easy'\|'medium'\|'hard', card_back?, music_url? }` | Phase 4 / OOP-4219 | `/api/upload/photo?kind=memory_cards` |
| `dragdrop_puzzle` | `{ photo_url, grid: 3\|4\|5, reveal_message }` | Phase 5 / OOP-4221 | `/api/upload/photo?kind=dragdrop_puzzle` |
| `quiz` | `{ questions: [{q, options (2–6), correct_idx, reveal_msg}] (1–30) }` (text only) | Phase 6 / OOP-4222 | none |
| `multimedia_collage` | `{ template, media: [{type, url, caption?, position: {x,y,w,h 0..1}}] (1–20), music_url? }` | Phase 7 / OOP-4223 | `/api/upload/photo?kind=multimedia_collage` for photos; `/api/upload/media` (photo ≤5 MB, video ≤50 MB, audio ≤25 MB) |
| `animated_letter` | `{ markdown, paper: 'cream'\|'kraft'\|'lined', envelope_color: 'honey'\|'blush'\|'sky', inline_media: [{type: 'photo'\|'voice'\|'music'\|'animation', url, caption?}] }` | **no builder yet** | n/a |

> **Boundary check.** `/g/[token]/open` re-validates the stored JSONB with the matching `*PayloadSchema` before mounting the recipient renderer. A parse failure (drift between builder and renderer) renders a "schema mismatch" placeholder rather than a half-broken gift. Treat any such placeholder as a builder/feature-files drift incident, not a network error.

### 3.3 Save draft
- Each builder's `save*DraftAction` writes a `gifts` row with `status='draft'` and a matching `shares` row (token reserved but not yet used; RLS for view).
- `revalidatePath` on the builder route so reload reflects the draft.

### 3.4 Publish to marketplace
- **Actor**: creator.
- **Entry**: `/create/[giftId]/finish` (the legacy MVP path) **or** an in-builder "Publish" button (when Phases 4–7 added them).
- **Action**: `publishToMarketplaceAction(input)` (`src/lib/actions/publish.ts`).
- **Flow**:
  1. Zod-validate input (giftId UUID, title ≤100, description ≤500, price_cents ≥0 nullable, currency ∈ {usd,hkd,gbp,eur,jpy,cad,aud}, platform_fee_bps 500–10000).
  2. Load gift + creator's `stripe_charges_enabled`.
  3. **Empty-payload guard** (OOP-5438): rejects empty payloads with a builder-must-fill-first message.
  4. **Stripe gate**: if `effectivePriceCents > 0` and creator not Stripe-enabled → return `{ needsStripe: true, onboardingUrl }`. Client redirects to onboarding, then re-calls with `publishAfterStripe=true`.
  5. Update `gifts`: `is_listed=true, published_at=now()` + listing fields. Stamping `search_tsv` (no separate write; generated column).
- **Outcome**: `{ ok: true, giftId }` → client `redirect('/l/[giftId]')`.

### 3.5 Unpublish
- **Action**: `unpublishGiftAction({ giftId })` (in `publish.ts`).
- **Effect**: `is_listed=false`, `deleted_at=now()` (soft-delete so analytics stay intact; see migration comment in `0002_marketplace_v2.sql` assumption A).

---

## 4. Checkout & purchase

Entry: `/checkout/[giftId]`, `/checkout/success`, `/purchases`.
Source files: `src/app/checkout/`, `src/app/purchases/`, `src/app/api/stripe/(connect-link|webhook)/`, `src/lib/actions/checkout.ts`, `src/lib/stripe.ts`, `supabase/migrations/0006_stripe_connect.sql`.

### 4.1 Start checkout
- **Actor**: signed-in Buyer (Stripe intent requires verified email).
- **Entry**: `/checkout/[giftId]` → `startCheckoutSessionAction(input)`.
- **Pre-gates** (action refuses to mint a session if any fail — never create a Checkout Session for a purchase that can't settle):
  1. Gift `is_listed = true` (not a draft).
  2. `price_cents > 0` (free gifts use [[#5.2 Free-gift share path]] instead).
  3. Creator's `stripe_charges_enabled = true`. If not → action returns Stripe-onboarding URL and aborts.
- **Money math**: `application_fee_amount = floor(amount_cents * platform_fee_bps / 10000)`. Default `platform_fee_bps=1000` (10%). `LOVEBYTE_MIN_FEE_BPS=500` enforced at DB level.
- **Delivery modes**:
  - `send_to_recipient` — requires recipient email (validated http(s)-style regex; ≤254 chars).
  - `buyer_shares` — buyer gets the share token themselves; no email needed.
- **Stripe call**: Destination charge on the creator's connected account; `application_fee_amount` set; `metadata={ gift_id, buyer_id, delivery_mode, recipient_contact? }`.
- **Side effects (in webhook, not action)**: insert `purchases` row, mint `shares` row, fire recipient email.

### 4.2 Webhook (`/api/stripe/webhook`)
- **Idempotency**: every handler must `INSERT INTO stripe_webhook_events(event_id) ON CONFLICT DO NOTHING` *before* dispatch (`0006_stripe_connect.sql`).
- **Handlers**: `checkout.session.completed`, `account.updated` (syncs `stripe_charges_enabled` onto the profile).
- **Auth**: service-role client (server-side only). Reject non-`POST` and missing Stripe signature.

### 4.3 Success page
- **Entry**: `/checkout/success?session_id=cs_…`.
- **Lookup**: `purchases.stripe_session_id` index. Shows the share token link or, for `send_to_recipient`, a "We've sent it" confirmation.
- **Race**: the webhook is the source of truth for "did this pay". If the redirect lands before the webhook settles, the page reads the session by `stripe_session_id`, finds no `purchases` row, and renders a "Processing — refresh in a moment" state rather than failing.

### 4.4 Cancel page
- **Entry**: `/checkout/cancel?session_id=cs_…`.
- **Behaviour**: public landing page. No DB writes; the Stripe Checkout Session expires on Stripe's side. The user can resume by hitting the listing page's CTA again.

### 4.5 Purchase history
- **Entry**: `/purchases` (authed).
- **Data**: `purchases` joined to `gifts` (`share_id IS NULL` filter for buyer-self, populated for sent-on-behalf). "Play now" CTA links to the share token (OOP-5438).
- **Failure modes**: missing `stripe_charges_enabled` history broken client-side is not expected, the UI renders shared status badges.

---

## 5. Recipient view (the most-shared surface)

Entry: `/g/[token]` (public, no auth), `/api/og/[token]` (OG image), `/g/[token]/reply` (recipient reply submit).
Source files: `src/app/g/[token]/`, `src/lib/actions/giftReplies.ts`, `src/app/api/gift-replies/[giftId]/` (REST surface), `src/app/api/og/[token]/`.

### 5.1 Open a gift
- **Actor**: Recipient (anon OK).
- **Entry**: two routes, both `runtime='edge'`:
  - `/g/[token]` (`src/app/g/[token]/page.tsx:65`) — the envelope front. Renders the "from X" line, envelope paper, and a "Open" button. Reads `getEnvelopeByToken` (`src/lib/gifts/fetch.ts`).
  - `/g/[token]/open` (`src/app/g/[token]/open/page.tsx:57`) — the type-dispatched renderer. Validates the stored payload with the matching Zod schema, then mounts `src/features/<type>/recipient/<View>.tsx` (or the inline `AnimatedLetter` component for the no-builder type).
- **Auth gate**: none — this is the viral loop. RLS `gifts_select_via_share` covers the embedded `gifts:gift_id` leg of `shares_select_public_by_token` ([[lovebyte-gifts-select-via-share-rls]]).
- **Open tracking** (stamped on `/g/[token]` mount):
  - First open → `unique_opened_at = now()` (powers the "opened 🎉" badge the sender sees).
  - Every open → `view_count += 1`, `last_opened_at = now()`.
- **Password gate** (optional): `shares.password_hash` → form on first render; bcrypt verify server-side before mount.
- **Expiry**: `shares.expires_at` → past date renders a polite "this gift has expired" view (recipient still sees a thank-you note; the gift body is hidden).
- **OG image**: `/api/og/[shareToken]` (`runtime='edge'`) returns a `next/og` PNG (1200×630) for link unfurls (WhatsApp / iMessage / Slack). This is the viral surface — it must render fast and look good in 300×157 preview crops.

### 5.2 Free-gift share path
- **Trigger**: gift with `price_cents IS NULL` or `price_cents = 0`.
- **Behaviour**: sender hits "Share" inside the builder → mints a `shares` row directly (no Stripe hop). For marketplace-listed free gifts, the listing card shows a "Free" badge and the CTA reads "Open" rather than "Buy".

### 5.3 Reply
- **Actor**: Recipient (anon OK).
- **Action**: `createGiftReplyAction({ giftId, body })` — but **replies attach to the listing**, not the share token (M-G design choice — replies are public-ish questions to the creator, not private thank-yous). The recipient has to navigate to `/l/[giftId]` to use it.
- **If you want a private reply** (the original `share_replies` table), the migration is still there but the MVP UI ships the public-style reply only.

### 5.4 Receipt analytics
- **Open counting (OOP-6716).** `shares.view_count`, `shares.last_opened_at` and `shares.unique_opened_at` are written when the recipient opens `/g/[token]/open`. The `unique_opened_at` stamp is the "first open" marker, so it is set once and never moved. Prefetch requests are excluded — a link preview is not an open.
- **Still not shipped.** The sender-facing surface — `/u/me` → collection tab with an "Opened" badge and a view count — does not exist. The counters are written and queryable in the database, but nothing renders them for the creator yet.

---

## 5A. Funnel analytics (OOP-6716)

The site had **no instrumentation at all** before this: no third-party analytics, no event table, and a `shares.view_count` column that nothing ever wrote or read. Every optimisation on the OOP-5816 board was therefore unfalsifiable — "9 people looked at the homepage" and "9 people bought" were the same number.

### 5A.1 The funnel

| Step | Event | Recorded by |
|---|---|---|
| 1 | `landing_view` | browser, on `/` |
| 2 | `browse_view` | browser, on `/browse` |
| 3 | `listing_view` | browser, on `/l/[giftId]` |
| 4 | `checkout_start` | server, when the Stripe session is created (or a free share is minted) |
| 5 | `purchase` | server, in the Stripe webhook (or a free share is minted) |

Side events: `cta_click`, `filter_used`, `search`, `listing_cta_click`, `waitlist_signup`, `gift_opened`, `reply_posted`, `liked`.

### 5A.2 Where the events live

- **Bucket** `lovorithm-analytics` (private, created over the Storage REST API — this host has no DDL path, see `src/lib/analytics/store.ts`).
- **Layout** `events/<event>/<date>__<sessionId>__<eventId>.json`. The name carries the event, the date and the session, so the report counts names and never downloads a body.
- **Session** an anonymous uuid in the httpOnly `lb-sid` cookie, minted by the proxy and forwarded as `x-lb-sid` so the first request of a session joins up. The browser never sees it.

### 5A.3 Reading the report

```bash
curl -H "Authorization: Bearer $INCIDENT_ADMIN_TOKEN" \
  "https://lovorithm.vercel.app/api/analytics/funnel?days=7"
```

Returns per-step event and session counts, the step-to-step conversion, a per-day breakdown, and the totals. No third-party dashboard.

### 5A.4 What is deliberately NOT recorded

No gift content, no email addresses, no share tokens, no user ids. Each event's props are described by a Zod schema that strips unknown keys, so the schema is the allowlist — a crafted request cannot smuggle a field past it. A search term is redacted server-side (emails and token-shaped strings are replaced) before it is stored.

---

## 6. Profile & settings

Entry: `/settings`, `/u/[handle]`, `/u/me`.
Source files: `src/app/settings/`, `src/app/u/[handle]/`, `src/app/api/upload/avatar`, `src/lib/profiles/handle.ts`, `src/lib/actions/profile.ts`.

### 6.1 Public profile (`/u/[handle]`)
- **Visibility**: anyone.
- **Data**: `profiles_public` view (excludes `avatar_url`, prefers `avatar_media_id` join) → hero (avatar, handle, display_name, bio ≤600, links[]), follower count, follow button, collection (gifts `is_listed AND deleted_at IS NULL`).
- **CSS coverage required**: any new `className=` must have a matching rule (OOP-5420 follow-up; [[lovebyte-profile-css-missing-m-b]]).

### 6.2 Edit profile (`/settings`)
- **Auth**: signed-in user editing own profile. RLS `profiles_update_own`.
- **Fields**: display_name, bio, links, avatar (uploaded via `/api/upload/avatar` — server-side, NOT signed PUT, OOP-4310), preferred_language.
- **Avatar upload**:
  - Bucket: `lovebyte-media` (private). Path: `avatars/<user-id>/<uuid>.<ext>`.
  - Server-side `POST /api/upload/avatar` (sb_secret_… cannot hit Storage REST directly → 404).
  - Updates `profiles.avatar_media_id` (Storage path is private; only signed URLs leak).
- **Media rendering helper**: `GET /api/media/[mediaId]` (cookie-required) returns a one-shot signed URL for the given `gift_media` row. RLS scopes the lookup to "owner OR attached to a listed gift" so listing pages can pull creator avatars without a separate Storage grant.

### 6.3 Handle change
- **Action**: `changeHandleAction(formData)` (auth.ts) → calls RPC `change_handle(p_id, p_new_handle)` which writes both `profiles.handle` and the `handle_history` audit row in one `SECURITY DEFINER` transaction.
- **Cooldown**: 30-day window between changes; RPC error code P0001 maps to `{ error: 'cooldown', retryAt }` in the client. Format errors (22023) map to `{ error: 'format', reason }`. The error mapping lives in `changeHandleAction`.
- **Audit & redirects**: `handle_history` (table) keeps every old handle with `UNIQUE (old_handle)` for 30 days. `getRedirectForOldHandle` is wired into the profile route — handle a handle change is no info leak; someone with an old link 301s to the new handle.
- **UI surface**: `/u/[handle]/edit` (separate from `/settings`) — `OnboardingForm` handles the first-time handle pick; `ProfileEditForm` handles subsequent changes (with cooldown feedback).

### 6.4 Account deletion (out of scope)
- Not implemented for MVP. `auth.users` cascades delete `profiles`, `gifts`, `shares`, `gift_comments`, `gift_replies`, `gift_likes`, `creator_follows` (per FK definitions).

---

## 7. Support, status, legal

Entry: `/support`, `/status`, `/privacy`, `/terms`.
Source files: `src/app/(support|status|privacy|terms)/`, `src/app/api/incidents/`, `src/lib/actions/waitlist.ts`, `supabase/migrations/0008_waitlist.sql`, `0009_incidents.sql`.

### 7.1 Status (`/status`)
- **Read**: anon-friendly. Reads last 7 days of `public.incidents` (`severity ∈ {operational, maintenance, degraded, outage}`).
- **Headline**: pill driven by the **most recent open** incident's severity (`resolved_at IS NULL`).
- **Write**: service-role only (admin route is a deferred follow-up).

### 7.2 Support (`/support`)
- Static form (mailto-link or inbox address); no ticket queue for MVP.

### 7.3 Legal (`/privacy`, `/terms`)
- Static MDX pages, EN + 繁中 via next-intl. Phase 10 / OOP-4226 acceptance criteria.

### 7.4 Waitlist capture (landing)
- **Actor**: Visitor.
- **Entry**: `/` `<WaitlistForm>` → `joinWaitlistAction(input)` (`src/lib/actions/waitlist.ts`).
- **Behaviour**:
  1. Zod-validate (email, intent ≤64, locale ∈ {en, zh-Hant}).
  2. Hash IP + UA (SHA-256) so the table carries no raw PII.
  3. Rate-limit: one submission per (ip_hash OR ua_hash) per hour.
  4. Turnstile gate (OOP-6161) — dormant until `TURNSTILE_SECRET_KEY` is set; fails closed when on.
  5. Insert via service-role client (RLS bypass). Conflict on `email_lc` is treated as success.
  6. Awaited autoresponder via Resend (OOP-6156). Needs `RESEND_API_KEY` + `RESEND_FROM` to actually send (OOP-6164).
- **Deferred**: /support-ticket backend.

---

## 8. Failure modes — global

These are the failure modes that span flows. If you ship code that creates one of these, you owe an entry here.

- **Email already-registered silent success** (OOP-5379): Supabase's `signUp` and `resend` both 200 with no email for already-verified users. Pre-check via `lookupEmail` in every flow that hits `/auth/v1/signup` or `/auth/v1/resend`.
- **Wrong Supabase URL baked into deploy** ([[lovebyte-wrong-supabase-url-baked-into-deploy]]): manual `POST /v13/deployments` misses env bindings. Use `vercel deploy --prod --global-config` for env inheritance; never skip git push (CLI deploy ships local tree, NOT `origin/main` — [[lovebyte-cli-deploy-without-git-push]]).
- **Legacy JWT secret leak** ([[lovebyte-supabase-key-leak-and-cli-gap]]): service_role JWT was pasted OOP-4211. Disable it via Dashboard → Settings → API → "Disable service role JWT" — kills `eyJ…service_role…` at gateway. `GET /api-keys` echoes the dead row; verify at the gateway, not via the API.
- **i18n key fallbacks** ([[lovebyte-nextjs-formatjs-angle-bracket-gotcha]] + [[lovebyte-i18n-namespace-nesting-gotcha]]): a missing key renders its raw key string with no crash. Angle brackets and `Profile.Profile.X` nesting both trip `useTranslations`. Audit via `node /Users/molt/.paperclip/run-scratch/oop-3438-sweep/audit-i18n.py`.
- **`useHandleAvailability` edge-deploy bug** ([[lovebyte-handle-check-throw-safe]]): the throw-safe wrapper was deployed edge-broken at one point (deterministic digest `1881044564`). Manual redeploy required; re-fetch deployment and verify before declaring "fixed".
- **Profile CSS gaps** ([[lovebyte-profile-css-missing-m-b]]): `/u/[handle]` markup shipped in M-B but CSS for hero / handle / bio / links / tabs / collection never landed. `curl` the deployed chunk and confirm every `className=` resolves to a rule.

---

## 9. Cross-check checklist (how to use this doc)

Before changing any flow, run this:

1. **Find the flow** in §1–§7 above.
2. **Read its Pre-checks / Side effects / Failure modes** sections.
3. **Open the listed source files** and confirm the change matches the contract documented here. If it doesn't, either:
   - keep the doc current (preferred for behavior changes), **or**
   - push back on the change if it breaks a load-bearing assumption (e.g. OOP-5438's empty-payload guard).
4. **Update the *Failure modes*** if the change introduces a new way to break.
5. **Update the *See also*** if the change links a new memory or issue.

If you are adding a *new* flow that crosses a trust boundary (writes to a new table, touches a new external API, exposes a new public route), add a new numbered section here before merging the code PR.

---

## 10. Versioning

- **Source of truth for code**: this document is regenerated by reading `src/app/**`, `src/lib/actions/**`, `src/app/api/**`, `supabase/migrations/**`. Anything not in those paths does not exist in the web.
- **Source of truth for behavior**: Zod schemas in `src/lib/gifts/schemas.ts` (payloads), DB CHECK constraints (migrations), and RLS policies (`0002_marketplace_v2_rls.sql`).
- **Source of truth for product decisions**: the closing comment of each milestone issue (OOP-4219..OOP-4226 + M-A..M-G). When a doc section disagrees with a closing comment, the closing comment wins until someone updates this doc.

Last verified: 2026-10-05 (initial consolidation, OOP-5689).