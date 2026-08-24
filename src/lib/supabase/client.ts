import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client.
 *
 * Use in Client Components (`'use client'`) for reads/writes that respect
 * RLS as the current authenticated user. The anon key is safe to ship to
 * the browser; row-level security is the actual access boundary.
 *
 * Database generics will be added once we run `supabase gen types typescript`
 * against the live project (blocked on the user creating the Supabase
 * Cloud project — see OOP-4211 blocker list).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
