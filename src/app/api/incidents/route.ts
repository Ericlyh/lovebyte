import { NextResponse } from 'next/server';
import {
  INCIDENT_COLUMNS,
  authorizeIncidentAdmin,
  incidentCreateSchema,
  type Incident,
} from '@/lib/incidents';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * POST /api/incidents — log a status-page incident (OOP-6156).
 *
 * Replaces the "insert a row in the Supabase SQL Editor" step in the
 * on-call runbook (docs/launch-checklist.md §6). The operator can log
 * an incident from a terminal without leaving the deploy context.
 *
 * Body: { severity, title, body?, status? }
 *   severity — 'operational' | 'maintenance' | 'degraded' | 'outage'
 *   title    — 1..200 chars
 *   body     — ≤4000 chars, optional
 *   status   — 'investigating' | 'identified' | 'monitoring' | 'resolved'
 *               (default 'investigating')
 *
 * Auth: `Authorization: Bearer $INCIDENT_ADMIN_TOKEN`. The token is a
 * server-only env var; there is no admin role in the app and the
 * on-call seat is the founder, not a registered account.
 *
 * Writes go through the service-role client, which bypasses RLS. The
 * table has no INSERT policy for anon / authenticated (migration
 * 0009), so this route is the only non-Dashboard write path.
 *
 * Status codes:
 *   201 { ok: true, incident }  — incident recorded
 *   400 { ok: false, error }    — body missing or fields invalid
 *   401 { ok: false, error }    — bad or missing admin token
 *   500 { ok: false, error }    — unexpected DB failure
 *   503 { ok: false, error }    — INCIDENT_ADMIN_TOKEN not configured
 */
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = authorizeIncidentAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = incidentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const { severity, title, body: incidentBody, status } = parsed.data;

  // `resolved_at` is the source of truth for "is this incident open" —
  // the /status page queries `resolved_at IS NULL`. An incident created
  // straight into 'resolved' therefore needs the timestamp set here,
  // not left null.
  const row = {
    severity,
    title,
    body: incidentBody,
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
  };

  const sb = await createServiceRoleClient();
  const { data, error } = await (
    sb.from('incidents') as unknown as {
      insert: (r: typeof row) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: Incident | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert(row)
    .select(INCIDENT_COLUMNS)
    .single();

  if (error) {
    console.error('[incidents/POST] insert failed', error.message);
    return NextResponse.json(
      { ok: false, error: 'Could not log that incident.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, incident: data }, { status: 201 });
}
