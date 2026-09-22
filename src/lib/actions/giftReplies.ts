'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Gift-reply server actions (M-G, OOP-4890).
 *
 * Threaded buyer→creator questions on `/l/[giftId]`. Distinct from
 * `comments.ts` (M-D): replies nest via `parent_reply_id` and the
 * gift's creator can prune their own thread (not just their own
 * messages), matching the description in OOP-4890.
 *
 *   - `createGiftReplyAction({ giftId, body, parentReplyId? })`
 *       Auth-gated insert. RLS `gift_replies_insert_own` enforces
 *       `auth.uid() = user_id`; we set it explicitly so PostgREST can
 *       resolve the `user:profiles_public!…` join on the return.
 *
 *   - `deleteGiftReplyAction({ replyId })`
 *       Hard delete. RLS `gift_replies_delete_own_or_creator` covers
 *       author and listing-creator. The gift's creator is allowed to
 *       prune the whole thread — this is the only difference from
 *       `deleteCommentAction`, which only lets the author delete.
 *
 * Why server actions and not `/api/gift-replies`?  Matches the
 * `createCommentAction` pattern (M-D). Moderation surface
 * (`/api/comment-reports`) still uses REST, since reports don't need
 * optimistic UI.
 */

const createSchema = z.object({
  giftId: z.string().uuid('giftId must be a UUID.'),
  body: z
    .string()
    .trim()
    .min(1, 'Reply cannot be empty.')
    .max(1000, 'Reply is too long (1000 chars max).'),
  // Optional parent reply id (top-level replies omit this). Allowed to
  // be null/undefined. Server verifies parent_reply_id actually belongs
  // to the same gift below.
  parentReplyId: z.string().uuid('parentReplyId must be a UUID.').optional(),
});

export type CreateGiftReplyInput = z.input<typeof createSchema>;

export type CreatedGiftReply = {
  id: string;
  body: string;
  created_at: string;
  parent_reply_id: string | null;
  user: {
    id: string;
    handle: string;
    display_name: string | null;
  };
};

export type CreateGiftReplyResult =
  | { ok: true; reply: CreatedGiftReply }
  | { ok: false; error: string };

export async function createGiftReplyAction(
  rawInput: unknown,
): Promise<CreateGiftReplyResult> {
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { giftId, body, parentReplyId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // Cross-gift guard: a `parent_reply_id` must belong to the same gift.
  // RLS would let any reply through (read-public), so we add an explicit
  // check before insert.
  if (parentReplyId) {
    const { data: parent, error: parentErr } = await supabase
      .from('gift_replies')
      .select('gift_id')
      .eq('id', parentReplyId)
      .maybeSingle();
    if (parentErr) {
      console.error('[replies/create] parent lookup error', parentErr);
      return { ok: false, error: 'Could not post your reply right now.' };
    }
    if (!parent || parent.gift_id !== giftId) {
      return { ok: false, error: 'Parent reply does not belong to this gift.' };
    }
  }

  const { data, error } = await supabase
    .from('gift_replies')
    .insert({
      gift_id: giftId,
      user_id: user.id,
      parent_reply_id: parentReplyId ?? null,
      body,
    })
    .select(
      'id, body, created_at, parent_reply_id, user:profiles_public!user_id (id, handle, display_name)',
    )
    .single();

  if (error || !data) {
    console.error('[replies/create] insert failed', error?.message);
    return { ok: false, error: 'Could not post your reply right now.' };
  }

  // Refresh the listing page so the new reply appears in the SSR'd
  // thread on next navigation. The client also keeps an optimistic
  // copy in its tree.
  revalidatePath(`/l/${giftId}`);

  const row = data as unknown as {
    id: string;
    body: string;
    created_at: string;
    parent_reply_id: string | null;
    user: { id: string; handle: string; display_name: string | null } | null;
  };

  return {
    ok: true,
    reply: {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      parent_reply_id: row.parent_reply_id,
      user: row.user ?? {
        id: user.id,
        handle: '',
        display_name: null,
      },
    },
  };
}

const deleteSchema = z.object({
  replyId: z.string().uuid('replyId must be a UUID.'),
});

export type DeleteGiftReplyResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteGiftReplyAction(
  rawInput: unknown,
): Promise<DeleteGiftReplyResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { replyId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // RLS `gift_replies_delete_own_or_creator` allows author OR listing
  // creator. We don't need to pre-check the role — RLS is the source
  // of truth. A 0-row delete (not author, not creator) is treated as a
  // soft-success for idempotency on double-clicks; we still surface an
  // error if Supabase returns one.
  const { error, count } = await supabase
    .from('gift_replies')
    .delete({ count: 'exact' })
    .eq('id', replyId);

  if (error) {
    console.error('[replies/delete] failed', error.message);
    return { ok: false, error: 'Could not delete that reply.' };
  }

  // Idempotent: a missing/already-deleted row is treated as success
  // so a double-click doesn't surface an error.
  void count;

  // Find the gift_id to revalidate the listing page.
  const { data: row } = await supabase
    .from('gift_replies')
    .select('gift_id')
    .eq('id', replyId)
    .maybeSingle();
  if (row?.gift_id) {
    revalidatePath(`/l/${row.gift_id}`);
  }

  return { ok: true };
}