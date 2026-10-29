import { createClient } from '@supabase/supabase-js';
import { supabaseFetch } from './net';

/**
 * Cookie-free Supabase client for public, anonymous reads.
 *
 * `@/lib/supabase/server` reads the auth cookie, and reading a cookie is
 * exactly what opts a route out of prerendering (OOP-6710). The catalog is
 * public data — `gifts_select_public_listed` lets an anonymous visitor read
 * every listed gift — so the feed can be read with the publishable key and
 * no session at all.
 *
 * The access boundary stays in RLS, not in the key: the publishable key
 * carries the `anon` role, so a row the policy does not expose is still
 * not readable. `gift_like_count` is `security definer`, so anon can call
 * it as well.
 *
 * Use this for reads that must not make the route dynamic. Use
 * `@/lib/supabase/server` when the read depends on who the visitor is.
 */
export function createPublicClient() {
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseKey) {
    throw new Error(
      '[supabase/public] NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) missing',
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, supabaseKey, {
    // OOP-5816: an unreachable host must fail fast, same as the server
    // client — otherwise the postgrest-js retry policy burns 7s of backoff
    // on every read against a dead project host.
    global: { fetch: supabaseFetch },
    // No session to persist and no URL to sniff: this client is anonymous
    // by construction, so the auth machinery would only add noise.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
