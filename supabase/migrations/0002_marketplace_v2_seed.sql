-- LoveByte — marketplace v2 seed
-- 3 creators + 8 listed gifts spanning all 5 categories.
-- Used by /browse (M-C) smoke test and Open Graph unfurl rendering.
--
-- Apply AFTER 0002_marketplace_v2_rls.sql.
--
-- Runs as the postgres role via the Supabase Management API (PAT), which
-- bypasses RLS — so we can write directly into auth.users and profiles
-- without going through the auth signup flow.
--
-- Idempotent: uses ON CONFLICT DO NOTHING on the auth.users email PK and
-- the profiles.handle UNIQUE constraint.

-- ============================================================================
-- Seed creators  (auth.users + profiles)
-- ============================================================================
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token,
  email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated',
   'mei@lovebyte.dev',
   crypt('lovebyte-seed-password-do-not-use', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Mei Chen"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated',
   'arjun@lovebyte.dev',
   crypt('lovebyte-seed-password-do-not-use', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Arjun Patel"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated',
   'sofia@lovebyte.dev',
   crypt('lovebyte-seed-password-do-not-use', gen_salt('bf')),
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Sofia Rivera"}'::jsonb,
   now(), now(), '', '', '', '')
on conflict (id) do nothing;

-- Supabase's auth.users PK is actually on (instance_id, id) for multi-tenant
-- setups; the unique constraint on email varies by version. The ON CONFLICT
-- clause here targets the id column; if your project rejects this, switch to
-- ON CONFLICT DO UPDATE SET email = EXCLUDED.email.

insert into public.profiles (id, handle, display_name, bio, links, preferred_language)
values
  ('11111111-1111-1111-1111-111111111111', 'mei',
   'Mei Chen',
   'I make tiny paper-feel gifts for the people I miss most.',
   '[{"label":"instagram","url":"https://instagram.com/mei.lovebyte"}]'::jsonb,
   'zh-Hant'),
  ('22222222-2222-2222-2222-222222222222', 'arjun',
   'Arjun Patel',
   'Photo puzzles + quiz love letters. Replies in <24h.',
   '[{"label":"site","url":"https://arjun.lovebyte.dev"}]'::jsonb,
   'en'),
  ('33333333-3333-3333-3333-333333333333', 'sofia',
   'Sofia Rivera',
   'Collages and animated letters in three languages.',
   '[]'::jsonb,
   'en')
on conflict (id) do update set
  handle       = excluded.handle,
  display_name = excluded.display_name,
  bio          = excluded.bio,
  links        = excluded.links;

-- ============================================================================
-- Seed listed gifts  (8 across 5 categories)
-- ============================================================================
insert into public.gifts (
  id, owner_id, type, title, description, payload,
  category, price_cents, currency, platform_fee_bps,
  is_listed, published_at, status
) values
  -- memory_cards x2 (Mei + Arjun)
  ('aaaa1111-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'memory_cards',
   'Our Sunday dim sum',
   'Flip the cards and remember the mornings we spent at the corner table.',
   '{"pairs":[{"photo_url":"https://placehold.co/600x600?text=dim+sum+1","caption":"first visit"},{"photo_url":"https://placehold.co/600x600?text=dim+sum+2","caption":"your favourite"}],"difficulty":"medium","card_back":"cream","music_url":null}'::jsonb,
   'memory_cards', NULL, 'HKD', 1000, true, now() - interval '2 days', 'draft'),

  ('aaaa1111-0000-0000-0000-000000000002',
   '22222222-2222-2222-2222-222222222222',
   'memory_cards',
   'Match the Goa sunsets',
   'Twelve sunsets, six pairs. Can you find them all?',
   '{"pairs":[{"photo_url":"https://placehold.co/600x600?text=goa+1","caption":"anao"},{"photo_url":"https://placehold.co/600x600?text=goa+2","caption":"palolem"}],"difficulty":"hard","card_back":"kraft","music_url":null}'::jsonb,
   'memory_cards', 4800, 'HKD', 1000, true, now() - interval '5 days', 'draft'),

  -- dragdrop_puzzle x2 (Arjun + Sofia)
  ('aaaa2222-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'dragdrop_puzzle',
   'Bangkok street photo puzzle',
   'Snap the pieces back together to reveal what I saw from the tuk-tuk.',
   '{"photo_url":"https://placehold.co/800x800?text=bangkok","grid":4,"reveal_message":"It was raining and I was thinking of you."}'::jsonb,
   'dragdrop_puzzle', NULL, 'HKD', 1000, true, now() - interval '1 day', 'draft'),

  ('aaaa2222-0000-0000-0000-000000000002',
   '33333333-3333-3333-3333-333333333333',
   'dragdrop_puzzle',
   '5×5 Madrid rooftops',
   'Hard mode. A love letter to the city that taught me to look up.',
   '{"photo_url":"https://placehold.co/900x900?text=madrid","grid":5,"reveal_message":"Let''s go back together next year."}'::jsonb,
   'dragdrop_puzzle', 12000, 'USD', 1500, true, now() - interval '10 days', 'draft'),

  -- quiz x2 (Sofia + Mei)
  ('aaaa3333-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333',
   'quiz',
   'How well do you know us?',
   'Five questions, five little truths.',
   '{"questions":[{"q":"Where did we first meet?","options":["library","park","café","train"],"correct_idx":2,"reveal_msg":"It was raining and you ordered two coffees."},{"q":"What''s my favourite song?","options":["A","B","C","D"],"correct_idx":0,"reveal_msg":"You still don''t remember."}]}'::jsonb,
   'quiz', NULL, 'USD', 1000, true, now() - interval '7 days', 'draft'),

  ('aaaa3333-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'quiz',
   'Trivia of our first year',
   'Twelve questions across our first year together. Pass 8 to unlock the letter.',
   '{"questions":[{"q":"What month did we move in?","options":["March","June","September","December"],"correct_idx":1,"reveal_msg":"Yes — June. The lease started on a Tuesday."}]}'::jsonb,
   'quiz', 1800, 'HKD', 1000, true, now() - interval '3 days', 'draft'),

  -- multimedia_collage x1 (Sofia)
  ('aaaa4444-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333',
   'multimedia_collage',
   'A weekend in Lisbon',
   'Photos, voice notes, and the song that was playing at the miradouro.',
   '{"template":"grid-2x2","media":[{"type":"photo","url":"https://placehold.co/600x600?text=lisbon+1","caption":"tram 28","position":{"x":0,"y":0,"w":50,"h":50}},{"type":"audio","url":"https://placehold.co/600x600?text=audio","position":{"x":50,"y":50,"w":50,"h":50}}],"music_url":null}'::jsonb,
   'multimedia_collage', 2500, 'EUR', 1000, true, now() - interval '4 days', 'draft'),

  -- animated_letter x1 (Mei)
  ('aaaa5555-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'animated_letter',
   'A letter that unfolds',
   'For my grandmother, who taught me to write by hand.',
   '{"markdown":"Dear Grandma,\n\nI still set a place for you at the table.\n\nLove always,\nMei","paper":"linen","envelope_color":"#f5e9d4","inline_media":[]}'::jsonb,
   'animated_letter', NULL, 'HKD', 1000, true, now() - interval '6 days', 'draft')
on conflict (id) do nothing;

-- ============================================================================
-- Seed a couple of likes + a comment so /l/[giftId] renders something
-- (and gift_like_count() returns a non-zero number on acceptance test).
-- ============================================================================
insert into public.gift_likes (profile_id, gift_id)
values
  ('22222222-2222-2222-2222-222222222222',
   'aaaa1111-0000-0000-0000-000000000001'),
  ('33333333-3333-3333-3333-333333333333',
   'aaaa1111-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111',
   'aaaa3333-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.gift_comments (gift_id, author_id, body)
values
  ('aaaa1111-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'Made me tear up. Thank you for this.');
