/**
 * Edge-safe Supabase REST helper for anon-SELECT reads.
 *
 * No cookies. No `@supabase/supabase-js` (which would add a second
 * Supabase package). Just a typed `fetch` against PostgREST — the
 * access boundary lives in Postgres RLS, the anon key is safe to ship
 * to the browser, and the queries we need here are one-liners.
 *
 * Use this from Server Components and Edge Route Handlers that don't
 * have a cookie store. For authed reads/writes use `@/lib/supabase/server`.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Throw at import time in server contexts — the envs are required for
  // any DB read. Missing here means a misconfigured deploy.
  throw new Error(
    '[supabase/anon] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing',
  );
}

export type PostgrestError = { message: string; code?: string; details?: string };

type RequestInit = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: string;
  /** PostgREST `select=` projection. Defaults to `*`. */
  select?: string;
  /** PostgREST `=`-style filters, joined as `&key=eq.value`. */
  filters?: Record<string, string | number | boolean>;
  /** PostgREST order clause, e.g. `created_at.desc`. */
  order?: string;
  /** 0..1 — if set, returns the first row or `null` instead of an array. */
  limitToOne?: boolean;
};

export async function postgrest<T>(
  table: string,
  init: RequestInit = {},
): Promise<{ data: T | T[] | null; error: PostgrestError | null }> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (init.select) url.searchParams.set('select', init.select);
  if (init.order) url.searchParams.set('order', init.order);
  for (const [k, v] of Object.entries(init.filters ?? {})) {
    url.searchParams.set(k, `eq.${v}`);
  }
  if (init.limitToOne) {
    url.searchParams.set('limit', '1');
  }

  const res = await fetch(url.toString(), {
    method: init.method ?? 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body,
    cache: 'no-store',
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    return {
      data: null,
      error: {
        message: `postgrest ${init.method ?? 'GET'} ${table} → ${res.status}`,
        code: String(res.status),
        details: JSON.stringify(body),
      },
    };
  }

  const json = (await res.json()) as T[] | T | null;
  return { data: json, error: null };
}
