import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/comment-reports — file a moderation report on a comment
 * (M-D, OOP-4276).
 *
 * Body: { comment_id: string (uuid), reason: string (1..500 chars) }
 * Auth: required. RLS `comment_reports_insert_authenticated` already
 *       enforces `auth.uid() = reporter_id`, so we hand the reporter
 *       id straight from the session.
 *
 * Idempotency: deliberately NOT idempotent. The whole point of a
 * report is a human-in-the-loop signal; if the user submits twice
 * the second row is a new signal (different created_at), which is
 * what the moderation queue wants. The PK is a fresh uuid either way.
 *
 * Status codes:
 *   200 { ok: true }           — report recorded
 *   400 { ok: false, error }   — body missing or fields invalid
 *   401 { ok: false, error }   — no authenticated user
 *   500 { ok: false, error }   — unexpected DB / RLS failure
 */
export const runtime = 'nodejs';

const reportSchema = z.object({
  comment_id: z.string().uuid('comment_id must be a UUID.'),
  reason: z
    .string()
    .trim()
    .min(1, 'reason cannot be empty.')
    .max(500, 'reason is too long (500 chars max).'),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      },
      { status: 400 },
    );
  }
  const { comment_id: commentId, reason } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'Sign in to report a comment.' },
      { status: 401 },
    );
  }

  const { error } = await supabase.from('comment_reports').insert({
    comment_id: commentId,
    reporter_id: user.id,
    reason,
  });

  if (error) {
    console.error('[comment-reports/POST]', error.message);
    return NextResponse.json(
      { ok: false, error: 'Could not file that report right now.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}