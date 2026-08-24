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
 * Database generics will be added once `supabase gen types typescript` runs
 * against the live project (blocked on Supabase Cloud credentials — see
 * OOP-4211 blocker list).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
