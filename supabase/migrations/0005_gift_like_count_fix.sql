-- LoveByte — gift_like_count() parameter-shadow fix (M-C, OOP-4275).
--
-- The original 0002_marketplace_v2.sql defined:
--
--   create or replace function public.gift_like_count(gift_id uuid)
--   returns bigint language sql security definer stable as $$
--     select count(*)::bigint
--       from public.gift_likes
--       where gift_likes.gift_id = gift_id;
--   $$;
--
-- The function parameter `gift_id` shadows the column reference in a
-- way the planner folds into a tautology (`<param> = <param>`), so the
-- function returns the global like count for every gift instead of the
-- per-gift count. Subquery forms and explicit `gl.gift_id` aliases did
-- not fix it — only swapping the right-hand side to a positional `$1`
-- reference forces the comparison to use the actual parameter value.
--
-- Smoke test evidence (cloud `xsfbfqzmvjfxppvoxbze`, 2026-09-15):
--
--   select gift_id, count(*) from public.gift_likes group by gift_id;
--     aaaa1111-...0001 → 2
--     aaaa3333-...0001 → 1
--
--   -- buggy
--   select public.gift_like_count('aaaa1111-...0001'::uuid) → 3
--   select public.gift_like_count('aaaa2222-...0001'::uuid) → 3
--
--   -- fixed (positional $1)
--   select public.gift_like_count('aaaa1111-...0001'::uuid) → 2
--   select public.gift_like_count('aaaa2222-...0001'::uuid) → 0
--
-- Fix: rewrite the WHERE clause using the positional `$1` reference.
-- Public callers (PostgREST RPC) still pass `{gift_id: <uuid>}` — the
-- parameter NAME is unchanged, only the body uses `$1` internally.

create or replace function public.gift_like_count(gift_id uuid)
returns bigint
language sql
security definer
stable
set search_path to 'public'
as $$
  select count(*)::bigint
    from public.gift_likes
   where gift_likes.gift_id = $1;
$$;

grant execute on function public.gift_like_count(uuid) to anon, authenticated;
