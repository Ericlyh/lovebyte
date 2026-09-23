import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client (Server Components, Server Actions, Route Handlers).
 *
 * Reads/writes Supabase auth cookies via next/headers(). Wrapped in
 * try/catch on the set path because Server Components can't set cookies —
 * the auth library will refresh the session from a Server Action or
 * middleware boundary instead.
 *
 * API key (OOP-5048, follow-on from OOP-4894):
 *   Prefers `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the new `sb_publishable_…`
 *   format from Dashboard → API Keys) and falls back to
 *   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the legacy JWT). The legacy JWT is now
 *   401-rejected at the Supabase gateway since the "Disable service role
 *   JWT" toggle flipped 2026-09-22 — see `lovebyte-supabase-disable-legacy-jwt`.
 *   Per-request user identity is preserved via the Supabase auth cookie
 *   (the publishable key carries `anon` role + RLS context, NOT the service
 *   role). Do NOT swap to `SUPABASE_SECRET_KEY` here — that would bypass
 *   RLS and lose per-user authorisation.
 *
 * Database generics will be added once `supabase gen types typescript` runs
 * against the live project.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseKey) {
    throw new Error(
      '[supabase/server] NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) missing',
    );
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — ignore. The auth refresh
            // will be picked up by the proxy on the next request.
          }
        },
      },
    },
  );
}
