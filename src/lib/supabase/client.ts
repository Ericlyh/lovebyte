import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client.
 *
 * Use in Client Components (`'use client'`) for reads/writes that respect
 * RLS as the current authenticated user. The publishable key is safe to
 * ship to the browser; row-level security is the actual access boundary.
 *
 * API key (OOP-5048, follow-on from OOP-4894):
 *   Prefers `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the new `sb_publishable_…`
 *   format) and falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the legacy
 *   JWT). The legacy JWT has been 401-rejected at the Supabase gateway
 *   since 2026-09-22 — see `lovebyte-supabase-disable-legacy-jwt`.
 */
export function createClient() {
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseKey) {
    throw new Error(
      '[supabase/client] NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) missing',
    );
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey,
  );
}
