import 'server-only';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * Counting a gift open (OOP-6716).
 *
 * `public.shares` has carried `view_count`, `unique_opened_at` and
 * `last_opened_at` since migration 0001 — and until now nothing ever
 * wrote them and nothing ever read them. The columns were dead schema:
 * `docs/USER-FLOWS.md` described an "Opened 🎉" badge and a view count
 * as if they shipped, and they did not.
 *
 * The write is a read-then-update rather than an atomic increment,
 * because there is no SQL function to increment with and this host
 * cannot create one (the Management API PAT is dead — see
 * `src/lib/analytics/store.ts` for the whole story). Two simultaneous
 * opens of the same share could each read the same count and one
 * increment would be lost. For a gift link that is opened a handful of
 * times, that is an acceptable trade for an accurate-enough counter.
 *
 * The service-role client is used because `shares` has no UPDATE policy
 * for anon or authenticated users — the read is public (a share link is
 * a capability), the write is not.
 */

/**
 * How long the whole read+update may take.
 *
 * This runs on the gift-open page — the most latency-sensitive page in
 * the app, and the one a recipient is staring at while a gift loads. A
 * sick data layer must not add seconds to it, so the operation is
 * bounded and a timeout is logged rather than thrown. The page renders
 * regardless; only the counter is lost.
 */
const OPEN_COUNT_TIMEOUT_MS = 1500;

export type ShareOpenResult = {
  /** True when a `shares` row was found and its counters were bumped. */
  counted: boolean;
  error?: string;
};

type ShareCounters = {
  view_count?: number | null;
  unique_opened_at?: string | null;
};

export async function recordShareOpen(token: string): Promise<ShareOpenResult> {
  if (!token) return { counted: false };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ShareOpenResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ counted: false, error: 'timed out' }),
      OPEN_COUNT_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([countShareOpen(token), timeout]);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function countShareOpen(token: string): Promise<ShareOpenResult> {
  try {
    const sb = await createServiceRoleClient();

    const { data, error: readErr } = await (
      sb.from('shares') as unknown as {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{
              data: ShareCounters | null;
              error: { message: string } | null;
            }>;
          };
        };
      }
    )
      .select('view_count, unique_opened_at')
      .eq('token', token)
      .maybeSingle();

    if (readErr) return { counted: false, error: readErr.message };
    // No share row — a mock/demo token, or a link that was never
    // minted. There is nothing to count, and the caller uses this to
    // decide whether the open was a real one.
    if (!data) return { counted: false };

    const now = new Date().toISOString();
    const update = {
      view_count: (data.view_count ?? 0) + 1,
      last_opened_at: now,
      // The FIRST open only — this is the "Opened 🎉" marker.
      unique_opened_at: data.unique_opened_at ?? now,
    };

    const { error: updateErr } = await (
      sb.from('shares') as unknown as {
        update: (row: typeof update) => {
          eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update(update)
      .eq('token', token);

    if (updateErr) return { counted: false, error: updateErr.message };
    return { counted: true };
  } catch (err) {
    return { counted: false, error: (err as Error).message };
  }
}
