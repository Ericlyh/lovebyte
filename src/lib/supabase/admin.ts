import type { PostgrestError } from '@/lib/supabase/anon';

/**
 * Server-only Supabase admin lookup helper.
 *
 * Uses the project's secret key (`SUPABASE_SECRET_KEY`, sb_secret_… format)
 * to hit GoTrue's `/auth/v1/admin/users` endpoint, which is the only
 * server-side path that lets us ask "is this email already registered, and
 * if so, has it been confirmed?" without going through the public signUp
 * flow.
 *
 * Why not the regular service_role JWT? The 2024-08-25 rotation moved us
 * off `SUPABASE_SERVICE_ROLE_KEY` (JWT) onto `SUPABASE_SECRET_KEY` (the new
 * sb_secret_… format). The new key authenticates both PostgREST and GoTrue
 * admin — confirmed working against `xsfbfqzmvjfxppvoxbze` in OOP-4284
 * run `837e4c77-df42-4866-b614-a803c6564591`.
 *
 * Only imported from Server Actions, so it is server-only by construction.
 * Don't import from a Client Component — the secret would be bundled into
 * the browser JS.
 */

export type EmailLookup =
  | { state: 'verified'; userId: string; createdAt: string }
  | { state: 'pending'; userId: string; createdAt: string }
  | { state: 'not_found' };

type GoTrueUser = {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  created_at: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  // Throw at import time in server contexts — the envs are required.
  throw new Error(
    '[supabase/admin] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing',
  );
}

export async function lookupEmail(
  rawEmail: string,
): Promise<{ data: EmailLookup; error: PostgrestError | null }> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) {
    return { data: { state: 'not_found' }, error: null };
  }

  // GoTrue's list endpoint accepts an exact email filter. We ask for a
  // single page of 1 — if there's a hit, we'll see it in `users[0]`;
  // otherwise the array is empty.
  const url = new URL(`${SUPABASE_URL}/auth/v1/admin/users`);
  url.searchParams.set('email', email);
  url.searchParams.set('page', '1');
  url.searchParams.set('per_page', '1');

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: {
        apikey: SECRET_KEY!,
        Authorization: `Bearer ${SECRET_KEY}`,
      },
      cache: 'no-store',
    });
  } catch (e) {
    return {
      data: { state: 'not_found' },
      error: { message: `admin lookup network error: ${(e as Error).message}` },
    };
  }

  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    return {
      data: { state: 'not_found' },
      error: {
        message: `admin lookup → HTTP ${res.status}`,
        code: String(res.status),
        details: JSON.stringify(detail),
      },
    };
  }

  const body = (await res.json()) as { users?: GoTrueUser[] };
  const user = body.users?.[0];
  if (!user) {
    return { data: { state: 'not_found' }, error: null };
  }
  if (user.email_confirmed_at) {
    return {
      data: { state: 'verified', userId: user.id, createdAt: user.created_at },
      error: null,
    };
  }
  return {
    data: { state: 'pending', userId: user.id, createdAt: user.created_at },
    error: null,
  };
}
