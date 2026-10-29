import { z } from 'zod';

/**
 * The analytics vocabulary (OOP-6716).
 *
 * Before this module the site had zero instrumentation: no third-party
 * analytics, no event table, and a `shares.view_count` column that no
 * code ever wrote or read. Every other optimisation on the OOP-5816
 * board was therefore unfalsifiable — "9 people looked at the homepage"
 * and "9 people bought" were the same number.
 *
 * This file is the single definition of WHAT an event is. It is pure —
 * no I/O, no imports from the app — so both the server writer and the
 * browser reporter agree on the vocabulary, and so the shape can be
 * unit-tested without a network.
 *
 * ── The PII rule ──────────────────────────────────────────────────────────
 * Every event's props are described by a Zod object schema, and Zod
 * objects **strip unknown keys** by default. That is the whole privacy
 * guarantee: the schema IS the allowlist. A caller that sends
 * `{ term: 'x', email: 'a@b.com' }` gets `{ term: 'x' }` back — the
 * email is dropped before anything is written, by code that cannot be
 * bypassed by a crafted request. There is no "sanitise" step to forget.
 *
 * What must never appear in a logged event: gift content, email
 * addresses, share tokens. The schemas below have no field for any of
 * them, and a share token would be the one genuinely dangerous leak —
 * it is the credential that opens a gift.
 */

/** Every event the app can record. */
export const ANALYTICS_EVENTS = [
  // ── Funnel ────────────────────────────────────────────────────────────
  'landing_view',
  'browse_view',
  'listing_view',
  'checkout_start',
  'purchase',
  // ── Interaction ───────────────────────────────────────────────────────
  'cta_click',
  'filter_used',
  'search',
  'listing_cta_click',
  'waitlist_signup',
  'gift_opened',
  'reply_posted',
  'liked',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * The funnel, in order. The report walks this list and reports the drop
 * between consecutive steps — which is the number the business actually
 * wants ("where does it leak?").
 */
export const FUNNEL_STEPS = [
  'landing_view',
  'browse_view',
  'listing_view',
  'checkout_start',
  'purchase',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * Events the browser is allowed to report.
 *
 * The browser may only report what it can observe on the client — page
 * views and clicks. Everything that depends on a server-side outcome
 * (a Stripe session created, a webhook received, a row inserted) is
 * recorded server-side and is NOT in this list, so a crafted POST to
 * `/api/track` cannot fake a purchase.
 */
export const CLIENT_EVENTS = [
  'landing_view',
  'cta_click',
  'browse_view',
  'filter_used',
  'search',
  'listing_view',
  'listing_cta_click',
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];

const uuidish = z.string().trim().min(1).max(64);
const shortText = z.string().trim().min(1).max(64);
const giftType = z.string().trim().min(1).max(40);
const amountCents = z.number().int().nonnegative();

/**
 * A free-text search term, scrubbed.
 *
 * A search box is the one place on the site where a visitor can type
 * anything at all — including their own email address or a share token
 * someone sent them. The redaction runs SERVER-side (in this schema),
 * not in the browser, so it cannot be bypassed by a crafted request.
 *
 * Two rules:
 *   1. anything that looks like an email address is replaced;
 *   2. any run of 24+ word characters (a share token is 32 hex chars)
 *      is replaced — a long opaque string in a search box is either a
 *      credential or nothing worth analysing.
 * The result is capped at 64 characters.
 */
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const TOKEN_LIKE = /\b[A-Za-z0-9_-]{24,}\b/g;

export function redactSearchTerm(term: string): string {
  return term
    .replace(EMAIL_LIKE, '[redacted-email]')
    .replace(TOKEN_LIKE, '[redacted-token]')
    .slice(0, 64);
}

/**
 * Props per event.
 *
 * The keys are the entire vocabulary of what is known about a visitor
 * at each step. Note what is absent: no email, no share token, no gift
 * content, no user id. A `gift_id` is present on the listing and
 * purchase events because it is a PUBLIC identifier — it is already in
 * the listing URL — and it is what makes "which gift converts?"
 * answerable.
 */
export const EVENT_PROP_SCHEMAS = {
  landing_view: z.object({}),
  browse_view: z.object({}),

  cta_click: z.object({
    // Which button on the page was pressed.
    cta: z.enum(['create', 'browse', 'demo']),
  }),

  filter_used: z.object({
    filter: z.enum(['category', 'priceTier', 'creator', 'sort']),
    // Absent for `creator`: a handle identifies a person, so the
    // filter is recorded but not what was typed into it.
    value: shortText.optional(),
  }),

  search: z.object({
    term: z.string().transform(redactSearchTerm),
  }),

  listing_view: z.object({
    gift_type: giftType,
    gift_id: uuidish.optional(),
  }),

  listing_cta_click: z.object({
    gift_type: giftType,
    gift_id: uuidish.optional(),
  }),

  checkout_start: z.object({
    gift_id: uuidish,
    gift_type: giftType.optional(),
    amount_cents: amountCents,
    // True when the listing is free (no Stripe session; the share is
    // minted directly). A free listing converts in the same click.
    free: z.boolean(),
    delivery_mode: z.enum(['send_to_recipient', 'buyer_shares']),
  }),

  purchase: z.object({
    gift_id: uuidish,
    amount_cents: amountCents,
    currency: z.string().trim().length(3),
    free: z.boolean(),
  }),

  waitlist_signup: z.object({
    locale: z.enum(['en', 'zh-Hant']),
    source: shortText,
  }),

  gift_opened: z.object({
    // The gift TYPE only. Never the share token — the token is the
    // credential that opens the gift.
    gift_type: giftType,
  }),

  reply_posted: z.object({
    gift_id: uuidish,
    // Whether it was a threaded reply. The body is never recorded.
    has_parent: z.boolean(),
  }),

  liked: z.object({
    gift_id: uuidish,
  }),
} satisfies Record<AnalyticsEvent, z.ZodType>;

/** The parsed props type for an event. */
export type EventProps<E extends AnalyticsEvent> = z.output<
  (typeof EVENT_PROP_SCHEMAS)[E]
>;

export type ParsedEventProps =
  | { ok: true; props: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validate a props payload against an event's schema.
 *
 * Unknown keys are stripped by Zod (see the PII rule at the top of this
 * file), so the returned `props` is always a subset of the schema.
 */
export function parseEventProps(
  event: AnalyticsEvent,
  raw: unknown,
): ParsedEventProps {
  const schema = EVENT_PROP_SCHEMAS[event] as z.ZodType;
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue ? `${issue.path.join('.') || 'props'}: ${issue.message}` : 'Invalid props.',
    };
  }
  return { ok: true, props: parsed.data as Record<string, unknown> };
}

/** True when the browser may report this event. */
export function isClientEvent(event: string): event is ClientEvent {
  return (CLIENT_EVENTS as readonly string[]).includes(event);
}

// ---------------------------------------------------------------------------
// Storage layout
// ---------------------------------------------------------------------------

/**
 * Where an event is stored, and why the layout is what it is.
 *
 *   events/<event>/<date>__<sessionId>__<eventId>.json
 *
 * The path is not decoration — it is the query plan. Supabase Storage
 * has no aggregate query, so the report has to do its counting from
 * `list()` output. Putting the event name in the path means ONE list
 * call per event returns everything needed for the funnel:
 *
 *   - the event COUNT is the number of listed objects;
 *   - the UNIQUE SESSION COUNT is the number of distinct session ids
 *     parsed out of the object names;
 *   - the DATE is the first field of the object name.
 *
 * None of that requires downloading a single object body. The body
 * still holds the props, for a future props-level query, but the
 * funnel report never has to pay for it.
 *
 * The date is a FIELD of the name, not a folder. Supabase Storage's
 * `list()` is exactly one level deep: listing `events/<event>/` when
 * the events live in `events/<event>/<date>/` returns the DATES, not
 * the events, and every report would have to list each day separately.
 * A flat folder with the date encoded in the filename keeps the whole
 * event kind in one list call.
 */
export function eventObjectPath(
  event: AnalyticsEvent,
  date: string,
  sessionId: string,
  eventId: string,
): string {
  return `events/${event}/${date}__${sessionId}__${eventId}.json`;
}

/** The prefix that lists every event of one kind. */
export function eventPrefix(event: AnalyticsEvent): string {
  return `events/${event}`;
}

export type ParsedEventObject = {
  date: string;
  sessionId: string;
  eventId: string;
};

/**
 * Parse the path of a listed event object back into its parts.
 *
 * The listing under `events/<event>` returns names of the shape
 * `<date>__<sessionId>__<eventId>.json`.
 */
export function parseEventObjectPath(name: string): ParsedEventObject | null {
  const file = name.slice(name.lastIndexOf('/') + 1);
  if (!file.endsWith('.json')) return null;
  const stem = file.slice(0, -'.json'.length);
  const parts = stem.split('__');
  if (parts.length !== 3) return null;
  const [date, sessionId, eventId] = parts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!sessionId || !eventId) return null;
  return { date, sessionId, eventId };
}

/** The UTC day an event belongs to. Buckets are UTC days. */
export function eventDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type StepCounts = {
  /** How many times the step happened. */
  events: number;
  /** How many distinct sessions reached the step. */
  sessions: number;
};

export type AggregatedEvents = {
  total: StepCounts;
  byDate: Map<string, StepCounts>;
};

/**
 * Fold a list of listed event objects into per-step counts.
 *
 * `sessions` is the headline number: the issue's own framing is "9
 * people looked at the homepage" vs "9 people bought", which is a
 * session count, not an event count. One visitor who reloaded the
 * landing page three times is one person, not three.
 */
export function aggregateEvents(
  objects: ReadonlyArray<{ date: string; sessionId: string }>,
): AggregatedEvents {
  const totalSessions = new Set<string>();
  const byDate = new Map<string, { events: number; sessions: Set<string> }>();

  for (const obj of objects) {
    totalSessions.add(obj.sessionId);
    let bucket = byDate.get(obj.date);
    if (!bucket) {
      bucket = { events: 0, sessions: new Set<string>() };
      byDate.set(obj.date, bucket);
    }
    bucket.events += 1;
    bucket.sessions.add(obj.sessionId);
  }

  const totals: AggregatedEvents = {
    total: { events: objects.length, sessions: totalSessions.size },
    byDate: new Map(),
  };
  for (const [date, bucket] of byDate) {
    totals.byDate.set(date, { events: bucket.events, sessions: bucket.sessions.size });
  }
  return totals;
}

/**
 * The funnel view of a set of per-step counts.
 *
 * `stepRate` is the conversion from the previous step; `overallRate` is
 * the conversion from the first step. `stepRate` of the first step is
 * 1 by definition — it is the denominator for everything else.
 */
export function buildFunnel(
  steps: ReadonlyArray<{ step: AnalyticsEvent; counts: StepCounts }>,
): Array<{
  step: AnalyticsEvent;
  events: number;
  sessions: number;
  stepRate: number | null;
  overallRate: number | null;
}> {
  const first = steps[0]?.counts.sessions ?? 0;
  const out: Array<{
    step: AnalyticsEvent;
    events: number;
    sessions: number;
    stepRate: number | null;
    overallRate: number | null;
  }> = [];

  steps.forEach((entry, index) => {
    const previous = index === 0 ? null : steps[index - 1]?.counts.sessions ?? 0;
    out.push({
      step: entry.step,
      events: entry.counts.events,
      sessions: entry.counts.sessions,
      stepRate: previous === null ? null : previous === 0 ? 0 : entry.counts.sessions / previous,
      overallRate: first === 0 ? 0 : entry.counts.sessions / first,
    });
  });
  return out;
}
