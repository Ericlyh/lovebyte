'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { CodeDraftInputSchema, CodeReviewInputSchema } from '@/features/code/schemas';
import { CodeGiftPayloadSchema } from '@/lib/gifts/schemas';
import { isCodeGiftStorable, scanCodeGift } from '@/lib/gifts/code-scan';
import { reviewCodeGift, type CodeAiReviewResult } from '@/lib/gifts/code-ai';

/**
 * Server actions for the `code` gift type (OOP-5688).
 *
 * Two actions:
 *
 *   - `saveCodeGiftAction` — the authoritative gate. It re-runs the safety
 *     scanner on the server (the builder's live scan is a convenience, not
 *     a control), refuses to store a gift that trips a blocking rule, and
 *     only then writes the gifts + shares rows.
 *
 *   - `reviewCodeGiftAction` — the AI pass. Requires a signed-in user so
 *     the endpoint is not an open proxy onto the model provider.
 */

export type SaveCodeGiftResult =
  | { ok: true; giftId: string; shareToken: string }
  | { ok: false; error: string };

export type ReviewCodeGiftResult = CodeAiReviewResult;

/**
 * Per-user cooldown for the AI review.
 *
 * The review spends model tokens on the server, so it cannot be a free
 * endpoint for anyone who can sign up. This is best-effort by nature:
 * serverless instances do not share memory, so a determined caller could
 * still spread requests across instances. It stops the easy case (one
 * account, one button, in a loop) without needing a database table for
 * counters — and a table would need a migration we cannot run.
 */
const REVIEW_COOLDOWN_MS = 30_000;
const reviewCooldowns = new Map<string, number>();

function isReviewCoolingDown(userId: string): boolean {
  const now = Date.now();
  const last = reviewCooldowns.get(userId) ?? 0;
  if (now - last < REVIEW_COOLDOWN_MS) return true;
  reviewCooldowns.set(userId, now);
  if (reviewCooldowns.size > 500) {
    for (const [key, at] of reviewCooldowns) {
      if (now - at > REVIEW_COOLDOWN_MS) reviewCooldowns.delete(key);
    }
  }
  return false;
}

function generateShareToken(): string {
  // 16 random bytes → 32 hex chars. Matches `shares.token` SQL default
  // (encode(gen_random_bytes(16),'hex')) so the format is identical to
  // what the DB would mint if we'd left it to DEFAULT.
  return randomBytes(16).toString('hex');
}

export async function saveCodeGiftAction(
  rawInput: unknown,
): Promise<SaveCodeGiftResult> {
  const parsed = CodeDraftInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, error: 'Sign in to save a draft.' };
  }

  // The safety gate. The browser already ran this to colour the warnings
  // in the builder, but the browser is not trusted — this runs again on
  // the only path that writes to the database.
  const scan = scanCodeGift({
    html: input.html,
    css: input.css,
    js: input.js,
  });
  if (!isCodeGiftStorable(scan)) {
    return {
      ok: false,
      error:
        'This gift cannot be hosted: it tries to reach the page around it or send data out. Remove the flagged code and try again.',
    };
  }

  const payload = CodeGiftPayloadSchema.parse({
    html: input.html,
    css: input.css,
    js: input.js,
  });

  // 1. Insert the gift row first so the share FK has something to point at.
  const { data: gift, error: giftErr } = await supabase
    .from('gifts')
    .insert({
      owner_id: user.id,
      type: 'code',
      title: input.title,
      payload,
      status: 'sent',
    })
    .select('id')
    .single();

  if (giftErr || !gift) {
    console.error('[code] gift insert failed', giftErr?.message);
    // The `code` gift type is a Postgres enum value. Until migration 0011
    // has been applied, the insert is rejected by the database — tell the
    // sender that rather than "try again", because retrying cannot help.
    if (giftErr?.message?.includes('gift_type')) {
      return {
        ok: false,
        error:
          'Code gifts are not switched on for this site yet. The team has to run one small database update first.',
      };
    }
    return { ok: false, error: 'Could not save the gift. Try again.' };
  }

  // 2. Mint the share token and insert the shares row.
  const shareToken = generateShareToken();
  const { error: shareErr } = await supabase.from('shares').insert({
    token: shareToken,
    gift_id: gift.id,
    created_by: user.id,
  });

  if (shareErr) {
    console.error('[code] share insert failed', shareErr.message);
    // Best-effort cleanup: remove the orphaned gift so /u/me doesn't
    // list a gift that has no shareable link.
    await supabase.from('gifts').delete().eq('id', gift.id);
    return { ok: false, error: 'Could not create the share link. Try again.' };
  }

  return { ok: true, giftId: gift.id, shareToken };
}

/**
 * Ask the AI to review the gift. Auth-gated: this spends model tokens on
 * the server, so it must not be reachable without a signed-in user.
 */
export async function reviewCodeGiftAction(
  rawInput: unknown,
): Promise<ReviewCodeGiftResult> {
  const parsed = CodeReviewInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Sign in to use the AI review.' };
  }

  if (isReviewCoolingDown(user.id)) {
    return {
      ok: false,
      error: 'Give it a moment before asking the AI again.',
    };
  }

  return reviewCodeGift(
    {
      html: parsed.data.html,
      css: parsed.data.css,
      js: parsed.data.js,
    },
    parsed.data.answers,
  );
}

/**
 * Form-action variant — same logic but redirects on success so the
 * builder form's `<form action={…}>` submission Just Works without
 * any client-side JS. Throws on success because that's how
 * Next.js server-action redirects work; the surrounding <form>
 * catches the navigation.
 */
export async function saveCodeGiftFormAction(formData: FormData) {
  const rawJson = formData.get('payload') as string | null;
  if (!rawJson) {
    throw new Error('Missing payload.');
  }
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(rawJson);
  } catch {
    throw new Error('Malformed payload.');
  }

  const result = await saveCodeGiftAction(parsedPayload);
  if (!result.ok) {
    throw new Error(result.error);
  }
  redirect(`/create/${result.giftId}/finish?share=${result.shareToken}`);
}
