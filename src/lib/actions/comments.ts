'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * Comment server actions (M-D, OOP-4276).
 *
 * Two actions over the `gift_comments` table (M-A schema, RLS-gated):
 *
 *   - `createCommentAction({ giftId, body })` — auth-gated insert.
 *   - `deleteCommentAction({ commentId })`    — soft-delete via
 *     `deleted_at = now()`. RLS `gift_comments_delete_own` already
 *     scopes the UPDATE/DELETE to `auth.uid() = author_id`, so the
 *     server action can hand the SQL through without re-checking.
 *
 * Why server actions and not `/api/gift-comments`?  Matches the
 * `toggleLikeAction` pattern (OOP-4275) and avoids duplicating the
 * auth + RLS wiring. The M-D description originally wrote `/api/...`
 * routes but the codebase settled on server actions for write paths;
 * the moderation surface (`/api/comment-reports`) still uses a REST
 * route since reports don't need optimistic UI.
 */

const createSchema = z.object({
  giftId: z.string().uuid('giftId must be a UUID.'),
  body: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty.')
    .max(1000, 'Comment is too long (1000 chars max).'),
});

export type CreateCommentInput = z.input<typeof createSchema>;

export type CreatedComment = {
  id: string;
  body: string;
  created_at: string;
  author: {
    id: string;
    handle: string;
    display_name: string | null;
  };
};

export type CreateCommentResult =
  | { ok: true; comment: CreatedComment }
  | { ok: false; error: string };

export async function createCommentAction(
  rawInput: unknown,
): Promise<CreateCommentResult> {
  const parsed = createSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { giftId, body } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // RLS `gift_comments_insert_own` enforces `auth.uid() = author_id`;
  // we set it from the session explicitly so PostgREST can resolve the
  // foreign key on the `author:profiles!…` join.
  const { data, error } = await supabase
    .from('gift_comments')
    .insert({ gift_id: giftId, author_id: user.id, body })
    .select(
      'id, body, created_at, author:profiles!gift_comments_author_fk(id, handle, display_name)',
    )
    .single();

  if (error || !data) {
    console.error('[comments/create] insert failed', error?.message);
    return { ok: false, error: 'Could not post your comment right now.' };
  }

  // Refresh the listing page so the new comment appears in the SSR'd
  // thread on next navigation. The client also keeps an optimistic copy
  // for instant feedback.
  revalidatePath(`/l/${giftId}`);

  const row = data as unknown as {
    id: string;
    body: string;
    created_at: string;
    author: { id: string; handle: string; display_name: string | null } | null;
  };

  return {
    ok: true,
    comment: {
      id: row.id,
      body: row.body,
      created_at: row.created_at,
      // RLS can't grant SELECT on profiles_public to a freshly-inserted
      // author row that hasn't been re-read yet; fall back to a minimal
      // shape so the optimistic card still renders with the viewer's
      // own handle/display_name from the client.
      author: row.author ?? {
        id: user.id,
        handle: '',
        display_name: null,
      },
    },
  };
}

const deleteSchema = z.object({
  commentId: z.string().uuid('commentId must be a UUID.'),
});

export type DeleteCommentResult =
  | { ok: true }
  | { ok: false; error: string };

export async function deleteCommentAction(
  rawInput: unknown,
): Promise<DeleteCommentResult> {
  const parsed = deleteSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const { commentId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'unauthenticated' };
  }

  // Soft-delete: UPDATE deleted_at rather than DELETE. RLS
  // `gift_comments_update_own` allows it for the author only.
  const { error, count } = await supabase
    .from('gift_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId)
    .eq('author_id', user.id);

  if (error) {
    console.error('[comments/delete] soft-delete failed', error.message);
    return { ok: false, error: 'Could not delete that comment.' };
  }

  // Idempotent: a missing/already-deleted row is treated as success
  // so a double-click doesn't surface an error.
  void count;

  // Find the gift_id to revalidate the listing page. We have to look
  // it up because the action only receives the comment id; the row
  // itself is filtered out by RLS after the soft-delete lands.
  const { data: row } = await supabase
    .from('gift_comments')
    .select('gift_id')
    .eq('id', commentId)
    .maybeSingle();
  if (row?.gift_id) {
    revalidatePath(`/l/${row.gift_id}`);
  }

  return { ok: true };
}