import { NextResponse } from 'next/server';
import { authorizeAnalyticsAdmin } from '@/lib/analytics/admin';
import {
  ANALYTICS_EVENTS,
  FUNNEL_STEPS,
  aggregateEvents,
  buildFunnel,
  type AnalyticsEvent,
  type StepCounts,
} from '@/lib/analytics/events';
import { listEventObjects } from '@/lib/analytics/store';

/**
 * GET /api/analytics/funnel — the funnel report (OOP-6716).
 *
 * The site had no instrumentation at all before this, so "9 people
 * looked at the homepage" and "9 people bought" were indistinguishable.
 * This route is the answer: per-step counts for
 *
 *   landing_view → browse_view → listing_view → checkout_start → purchase
 *
 * plus every other event kind, and the drop between consecutive steps.
 *
 * Auth: `Authorization: Bearer $INCIDENT_ADMIN_TOKEN` — the same
 * operator token the status-page admin routes use (one operator, one
 * token). Fails closed: no token configured ⇒ 503, wrong token ⇒ 401.
 *
 * How it reads the data: every event kind is one Supabase Storage
 * `list()` call. The event name, the date and the session id are all
 * encoded in the object NAME, so the counts come from the listing
 * alone — no object body is downloaded, and the cost does not grow
 * with traffic.
 *
 * Query parameters:
 *   from=YYYY-MM-DD   first day of the range (default: `days` ago)
 *   to=YYYY-MM-DD     last day of the range  (default: today, UTC)
 *   days=N            shorthand for the last N days (default 7)
 *
 * Status codes:
 *   200 { ok: true, steps, funnel, daily, totals }
 *   401 { ok: false, error }  — bad or missing admin token
 *   503 { ok: false, error }  — admin token not configured
 */
export const runtime = 'nodejs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export async function GET(request: Request) {
  const auth = authorizeAnalyticsAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const today = isoDate(new Date());

  let from = url.searchParams.get('from');
  let to = url.searchParams.get('to');

  if (!from || !to) {
    const daysParam = url.searchParams.get('days');
    const parsed = daysParam ? Number.parseInt(daysParam, 10) : 7;
    const days = Number.isFinite(parsed) && parsed > 0 && parsed <= 90 ? parsed : 7;
    to = to ?? today;
    from = from ?? shiftDays(to, -(days - 1));
  }

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { ok: false, error: 'from and to must be YYYY-MM-DD.' },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json(
      { ok: false, error: 'from must not be after to.' },
      { status: 400 },
    );
  }
  // The daily breakdown walks the range day by day; an unbounded range
  // would turn one request into thousands of iterations.
  if (shiftDays(from, 90) <= to) {
    return NextResponse.json(
      { ok: false, error: 'The range is limited to 90 days.' },
      { status: 400 },
    );
  }

  // One list call per event kind, in parallel.
  const listings = await Promise.all(
    ANALYTICS_EVENTS.map(async (event) => ({
      event,
      result: await listEventObjects(event),
    })),
  );

  const byEvent = new Map<AnalyticsEvent, StepCounts>();
  const dailyByEvent = new Map<AnalyticsEvent, Map<string, StepCounts>>();
  let truncated = false;

  for (const { event, result } of listings) {
    if (result.truncated) truncated = true;

    const inRange = result.objects.filter((o) => o.date >= from && o.date <= to);
    const agg = aggregateEvents(inRange);
    byEvent.set(event, agg.total);

    const perDate = new Map<string, StepCounts>();
    for (const [date, counts] of agg.byDate) perDate.set(date, counts);
    dailyByEvent.set(event, perDate);
  }

  // The funnel steps, in order, with the drop between them.
  const funnelSteps = FUNNEL_STEPS.map((step) => ({
    step,
    counts: byEvent.get(step) ?? { events: 0, sessions: 0 },
  }));
  const funnel = buildFunnel(funnelSteps);

  // Every event kind, so the report also answers "how many replies?".
  const steps = ANALYTICS_EVENTS.map((event) => ({
    step: event,
    ...(byEvent.get(event) ?? { events: 0, sessions: 0 }),
  }));

  // Per-day counts across the range.
  const dates: string[] = [];
  for (let d = from; d <= to; d = shiftDays(d, 1)) dates.push(d);

  const daily = dates.map((date) => {
    const events: Record<string, number> = {};
    const sessions: Record<string, number> = {};
    for (const event of ANALYTICS_EVENTS) {
      const counts = dailyByEvent.get(event)?.get(date);
      if (!counts) continue;
      events[event] = counts.events;
      sessions[event] = counts.sessions;
    }
    return { date, events, sessions };
  });

  const totalEvents = steps.reduce((sum, s) => sum + s.events, 0);
  const allSessions = new Set<string>();
  for (const { result } of listings) {
    for (const obj of result.objects) {
      if (obj.date >= from && obj.date <= to) allSessions.add(obj.sessionId);
    }
  }

  return NextResponse.json({
    ok: true,
    from,
    to,
    steps,
    funnel,
    daily,
    totals: { events: totalEvents, sessions: allSessions.size },
    truncated,
  });
}
