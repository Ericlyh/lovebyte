import 'server-only';
import {
  eventDate,
  eventObjectPath,
  eventPrefix,
  parseEventObjectPath,
  type AnalyticsEvent,
  type ParsedEventObject,
} from './events';

/**
 * The event store (OOP-6716).
 *
 * ── Why Supabase Storage and not a Postgres table ────────────────────────
 * The obvious design is a `public.events` table. This host cannot create
 * one: the Management API PAT is dead (401 on
 * `POST /v1/projects/{ref}/database/query`), there is no database
 * password, there is no `exec_sql` RPC, and `pg_graphql` is disabled —
 * so DDL is a human paste into the Dashboard SQL Editor, exactly as
 * migrations 0011 and 0012 still are. Shipping an analytics feature
 * that waits on a human paste means shipping no analytics.
 *
 * Supabase Storage, on the other hand, is fully usable from the app
 * server: the secret key authorises bucket creation and object writes
 * over the Storage REST API, and the object LIST is a plain read. The
 * bucket (`lovorithm-analytics`, private) was created that way on
 * 2026-10-29.
 *
 * The cost is that there is no SQL to aggregate with. The storage
 * layout in `events.ts` exists to make up for it: the event name, the
 * date and the session id are all encoded in the object NAME, so the
 * funnel report is a `list()` and a count — no object body is ever
 * downloaded, and there is no per-report cost that grows with traffic.
 *
 * If the team later wants a Postgres table (SQL aggregation, longer
 * retention, ad-hoc queries), this module is the only thing that has to
 * change: it exposes `recordEvent` and `listEventObjects`, and nothing
 * above it knows where the events live.
 *
 * ── Why raw fetch and not the supabase-js Storage client ────────────────
 * `src/lib/supabase/net.ts` deliberately gives Storage calls NO
 * deadline, because a 50MB video upload is a legitimate multi-minute
 * request. An analytics event is a 200-byte JSON blob, and it is
 * written from page renders (the gift-open page) — so it must not be
 * able to hang a render. The two calls below therefore talk to the
 * Storage REST API directly with their own deadline, and leave the
 * shared network policy (and the media upload path) alone.
 */

/**
 * The private bucket. `id` and `name` are the same string — the Storage
 * API resolves a bucket by ID, and a row where they differ is a bucket
 * that cannot be addressed (the `lovorithm-media` trap, see
 * `src/lib/brand.ts`).
 */
export const ANALYTICS_BUCKET = 'lovorithm-analytics';

/**
 * An analytics write is a few hundred bytes, and it happens on the
 * request path (a buyer waiting for a checkout link). 1.5s is generous
 * for a healthy data layer and bounds the damage when it is not.
 */
const WRITE_DEADLINE_MS = 1500;

/** A list of one event kind. Also a few hundred bytes of JSON. */
const READ_DEADLINE_MS = 3000;

/** Supabase Storage's per-list page size. */
const LIST_PAGE_SIZE = 1000;

/** Hard ceiling on pages read by one report, so a runaway writer cannot make it unbounded. */
const MAX_LIST_PAGES = 50;

export type RecordResult = { ok: true } | { ok: false; error: string };

type StorageConfig = { url: string; key: string } | { error: string };

function storageConfig(): StorageConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return { error: 'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing' };
  }
  return { url: url.replace(/\/+$/, ''), key };
}

/** Percent-encode each path segment; the separators stay literal. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Write one event.
 *
 * Never throws: an analytics failure must not take a purchase or a
 * page render down with it. The caller logs the failure and carries on.
 */
export async function recordEvent(input: {
  event: AnalyticsEvent;
  sessionId: string;
  props?: Record<string, unknown>;
  date?: string;
  eventId?: string;
}): Promise<RecordResult> {
  const config = storageConfig();
  if ('error' in config) return { ok: false, error: config.error };

  const eventId = input.eventId ?? crypto.randomUUID();
  const date = input.date ?? eventDate();
  const path = eventObjectPath(input.event, date, input.sessionId, eventId);

  const body = JSON.stringify({
    event: input.event,
    session_id: input.sessionId,
    event_id: eventId,
    ts: new Date().toISOString(),
    props: input.props ?? {},
  });

  try {
    const res = await fetch(
      `${config.url}/storage/v1/object/${ANALYTICS_BUCKET}/${encodePath(path)}`,
      {
        method: 'POST',
        headers: {
          apikey: config.key,
          Authorization: `Bearer ${config.key}`,
          'Content-Type': 'application/json',
          // Events are immutable. `x-upsert: false` also keeps a retried
          // write from silently replacing an existing event.
          'x-upsert': 'false',
        },
        body,
        signal: AbortSignal.timeout(WRITE_DEADLINE_MS),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `storage ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

type StorageEntry = { name: string };

/**
 * List every object of one event kind.
 *
 * Returns the parsed (date, sessionId, eventId) triples. The object
 * bodies are NOT downloaded — the report counts names, and the bodies
 * only matter for a props-level query that does not exist yet.
 *
 * The Storage list API is a POST with the prefix in the JSON body
 * (storage-js 2.116 sends it that way); a GET on the same path is not
 * the list route and answers "Bucket not found".
 */
export async function listEventObjects(
  event: AnalyticsEvent,
): Promise<{ objects: ParsedEventObject[]; truncated: boolean }> {
  const config = storageConfig();
  if ('error' in config) return { objects: [], truncated: false };

  const objects: ParsedEventObject[] = [];
  let truncated = false;

  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    let data: StorageEntry[];
    try {
      const res = await fetch(
        `${config.url}/storage/v1/object/list/${ANALYTICS_BUCKET}`,
        {
          method: 'POST',
          headers: {
            apikey: config.key,
            Authorization: `Bearer ${config.key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prefix: eventPrefix(event),
            limit: LIST_PAGE_SIZE,
            offset: page * LIST_PAGE_SIZE,
            sortBy: { column: 'name', order: 'asc' },
          }),
          signal: AbortSignal.timeout(READ_DEADLINE_MS),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error(
          `[analytics/store] list ${event} failed: ${res.status} ${detail.slice(0, 200)}`,
        );
        return { objects, truncated };
      }
      const parsed = (await res.json()) as StorageEntry[] | null;
      data = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error(`[analytics/store] list ${event} failed: ${(err as Error).message}`);
      return { objects, truncated };
    }

    for (const entry of data) {
      const parsed = parseEventObjectPath(entry.name);
      if (parsed) objects.push(parsed);
    }

    if (data.length < LIST_PAGE_SIZE) break;
    if (page === MAX_LIST_PAGES - 1) truncated = true;
  }

  return { objects, truncated };
}
