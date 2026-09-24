-- LoveByte — marketplace RLS v2
-- Companion to 0002_marketplace_v2.sql.
-- Drops the v1 owner-only policies on gifts/gift_media, then re-creates the
-- marketplace-aware policies. Other v1 policies (profiles_update/insert_own,
-- shares_*, share_replies_*) stay intact.

-- gifts ────────────────────────────────────────────────────────────────────
drop policy if exists "gifts_all_own"            on public.gifts;
drop policy if exists "gifts_select_public_listed" on public.gifts;
drop policy if exists "gifts_select_own"        on public.gifts;
drop policy if exists "gifts_insert_own"        on public.gifts;
drop policy if exists "gifts_update_own"        on public.gifts;
drop policy if exists "gifts_delete_own"        on public.gifts;

-- Anon + authenticated: read listed, live (not soft-deleted) gifts.
create policy "gifts_select_public_listed"
  on public.gifts for select
  using (is_listed = true and published_at is not null and deleted_at is null);

-- Owners can always read their own (drafts + unlisted + soft-deleted).
create policy "gifts_select_own"
  on public.gifts for select
  using (auth.uid() = owner_id);

create policy "gifts_insert_own"
  on public.gifts for insert
  with check (auth.uid() = owner_id);

create policy "gifts_update_own"
  on public.gifts for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "gifts_delete_own"
  on public.gifts for delete
  using (auth.uid() = owner_id);

-- gift_media ───────────────────────────────────────────────────────────────
drop policy if exists "gift_media_all_own"                 on public.gift_media;
drop policy if exists "gift_media_insert_own"              on public.gift_media;
drop policy if exists "gift_media_update_own"              on public.gift_media;
drop policy if exists "gift_media_delete_own"              on public.gift_media;
drop policy if exists "gift_media_select_public_for_listed" on public.gift_media;

create policy "gift_media_insert_own"
  on public.gift_media for insert
  with check (auth.uid() = owner_id);

create policy "gift_media_update_own"
  on public.gift_media for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "gift_media_delete_own"
  on public.gift_media for delete
  using (auth.uid() = owner_id);

-- Anon can read media attached to a listed gift (cover image for /browse,
-- /l/[giftId] hero). Owner can always read their own. Null owner_id is
-- allowed so seed scripts can insert placeholder rows.
create policy "gift_media_select_public_for_listed"
  on public.gift_media for select
  using (
    owner_id = auth.uid()
    or owner_id is null
    or exists (
      select 1
      from public.gifts g
      where g.cover_media_id = gift_media.id
        and g.is_listed = true
        and g.deleted_at is null
    )
  );

-- profiles ────────────────────────────────────────────────────────────────
drop policy if exists "profiles_select_public_display_name" on public.profiles;
drop policy if exists "profiles_select_public"              on public.profiles;

-- Public creators: anyone can read any profile (anon + authenticated).
-- Columns are restricted via the profiles_public view for the public surface.
create policy "profiles_select_public"
  on public.profiles for select
  using (true);

-- purchases ───────────────────────────────────────────────────────────────
drop policy if exists "purchases_select_buyer_or_seller" on public.purchases;

-- Buyer OR gift owner (seller) can SELECT. INSERT/UPDATE only via service_role
-- (webhook), which bypasses RLS — no INSERT/UPDATE policies needed.
create policy "purchases_select_buyer_or_seller"
  on public.purchases for select
  using (
    auth.uid() = buyer_id
    or exists (
      select 1 from public.gifts g
      where g.id = purchases.gift_id and g.owner_id = auth.uid()
    )
  );

-- gift_likes ──────────────────────────────────────────────────────────────
drop policy if exists "gift_likes_select_public" on public.gift_likes;
drop policy if exists "gift_likes_insert_own"    on public.gift_likes;
drop policy if exists "gift_likes_delete_own"    on public.gift_likes;

create policy "gift_likes_select_public"
  on public.gift_likes for select
  using (true);

create policy "gift_likes_insert_own"
  on public.gift_likes for insert
  with check (auth.uid() = profile_id);

create policy "gift_likes_delete_own"
  on public.gift_likes for delete
  using (auth.uid() = profile_id);

-- gift_comments ───────────────────────────────────────────────────────────
drop policy if exists "gift_comments_select_public" on public.gift_comments;
drop policy if exists "gift_comments_insert_own"    on public.gift_comments;
drop policy if exists "gift_comments_update_own"    on public.gift_comments;
drop policy if exists "gift_comments_delete_own"    on public.gift_comments;

create policy "gift_comments_select_public"
  on public.gift_comments for select
  using (deleted_at is null);

create policy "gift_comments_insert_own"
  on public.gift_comments for insert
  with check (auth.uid() = author_id);

create policy "gift_comments_update_own"
  on public.gift_comments for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

create policy "gift_comments_delete_own"
  on public.gift_comments for delete
  using (auth.uid() = author_id);

-- creator_follows ─────────────────────────────────────────────────────────
drop policy if exists "creator_follows_select_public" on public.creator_follows;
drop policy if exists "creator_follows_insert_own"    on public.creator_follows;
drop policy if exists "creator_follows_delete_own"    on public.creator_follows;

create policy "creator_follows_select_public"
  on public.creator_follows for select
  using (true);

create policy "creator_follows_insert_own"
  on public.creator_follows for insert
  with check (auth.uid() = follower_id);

create policy "creator_follows_delete_own"
  on public.creator_follows for delete
  using (auth.uid() = follower_id);

-- comment_reports ─────────────────────────────────────────────────────────
drop policy if exists "comment_reports_select_own"          on public.comment_reports;
drop policy if exists "comment_reports_insert_authenticated" on public.comment_reports;

-- Reporter can SELECT/INSERT their own reports. Moderation UI reads via
-- service_role (bypasses RLS).
create policy "comment_reports_select_own"
  on public.comment_reports for select
  using (auth.uid() = reporter_id);

create policy "comment_reports_insert_authenticated"
  on public.comment_reports for insert
  with check (auth.uid() = reporter_id);

-- gift_replies ─────────────────────────────────────────────────────────────
-- M-G, OOP-4890. Threaded buyer→creator questions on /l/[giftId].
--   read  : public (anon + authenticated)
--   insert: authenticated, only on behalf of self
--   update: only the author (so the body is immutable to others)
--   delete: the author OR the gift's creator (so creators can prune
--           abusive threads on their listing) OR service_role.
drop policy if exists "gift_replies_select_public" on public.gift_replies;
drop policy if exists "gift_replies_insert_own"    on public.gift_replies;
drop policy if exists "gift_replies_update_own"    on public.gift_replies;
drop policy if exists "gift_replies_delete_own_or_creator" on public.gift_replies;

create policy "gift_replies_select_public"
  on public.gift_replies for select
  using (true);

create policy "gift_replies_insert_own"
  on public.gift_replies for insert
  with check (auth.uid() = user_id);

create policy "gift_replies_update_own"
  on public.gift_replies for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "gift_replies_delete_own_or_creator"
  on public.gift_replies for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.gifts g
      where g.id = gift_replies.gift_id and g.owner_id = auth.uid()
    )
  );

-- waitlist ────────────────────────────────────────────────────────────────
-- Phase 10, OOP-4226. Pre-account email captures for the beta landing page.
--   read   : NO policy → anon + authenticated denied. service_role
--            bypasses RLS and is the only path (moderator dashboard).
--   insert : NO policy → anon + authenticated denied. `joinWaitlistAction`
--            (src/lib/actions/waitlist.ts) uses the service-role client and
--            gates with Turnstile before the insert. A client that bypasses
--            the server action cannot write here.
-- (RLS already enabled in 0008_waitlist.sql; this file is intentionally
--  appended-to so reviewers can grep "waitlist" and find the policy intent.)
