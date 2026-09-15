import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client (M-E, OOP-4277).
 *
 * Uses the same `SUPABASE_SECRET_KEY` (`sb_secret_…` format) as
 * `admin.ts`, but goes through `@supabase/supabase-js`'s PostgREST +
 * Storage surface so it BYPASSES Row-Level Security.
 *
 * The webhook (`/api/stripe/webhook`) and any future server-only
 * writes that need to operate outside the calling user's RLS context
 * must use this client. For user-scoped reads/writes, prefer the
 * cookie-based `server.ts` client (`createClient()` from
 * `@/lib/supabase/server`) so RLS enforces per-user authorization.
 *
 * Only the webhook, scheduled jobs, and similar server-internal paths
 * should import this. Never import from a client component — the
 * secret would end up in the browser bundle.
 *
 * Why a separate client from `admin.ts`? `admin.ts` is a narrow
 * `fetch`-based helper that only hits GoTrue. This is the
 * full-fat PostgREST/Storage client needed for `purchases` writes
 * and the dedup table.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SECRET_KEY) {
  throw new Error(
    '[supabase/service-role] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing',
  );
}

/**
 * The service-role client. Lazy-initialised so import-time throws
 * don't fire in test contexts that stub envs; the first await will
 * still fail loudly if envs are missing.
 *
 * `autoRefreshToken: false` — there is no user session to refresh; this
 * is a single long-lived service identity.
 * `persistSession: false` — no on-disk persistence; we don't want the
 * secret key material cached anywhere outside the process.
 */
let cached: ReturnType<typeof createClient> | null = null;

export async function createServiceRoleClient() {
  if (cached) return cached;
  cached = createClient(SUPABASE_URL!, SECRET_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
