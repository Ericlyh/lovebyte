import { NextResponse } from 'next/server';
import {
  INCIDENT_COLUMNS,
  authorizeIncidentAdmin,
  incidentUpdateSchema,
  type Incident,
} from '@/lib/incidents';
import { createServiceRoleClient } from '@/lib/supabase/service-role';

/**
 * PATCH /api/incidents/[id] — update or resolve a status-page incident
 * (OOP-6156).
 *
 * The write-side counterpart to `POST /api/incidents`. Logging an
 * incident is only half the on-call job — without a way to close it,
 * the status page stays red and the operator falls back to the SQL
 * Editor anyway.
 *
 * Body: any subset of { severity, title, body, status }
 *   body   — `null` clears the body
 *   status — 'investigating' | 'identified' | 'monitoring' | 'resolved'
 *
 * `resolved_at` is derived from `status`, because the /status page
 * decides "is this open" with `resolved_at IS NULL`:
 *   - status 'resolved'  → resolved_at = now()  (incident closes)
 *   - status != 'resolved' → resolved_at = NULL  (incident reopens)
 *   - status absent      → resolved_at untouched
 *
 * Auth: `Authorization: Bearer $INCIDENT_ADMIN_TOKEN`.
 *
 * Status codes:
 *   200 { ok: true, incident }  — incident updated
 *   400 { ok: false, error }    — id not a UUID, or body invalid / empty
 *   401 { ok: false, error }    — bad or missing admin token
 *   404 { ok: false, error }    — no such incident
 *   500 { ok: false, error }    — unexpected DB failure
 *   503 { ok: false, error }    — INCIDENT_ADMIN_TOKEN not configured
 */
export const runtime = 'nodejs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = authorizeIncidentAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'incident id must be a UUID.' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = incidentUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const { severity, title, body: incidentBody, status } = parsed.data;

  const patch: Record<string, unknown> = {};
  if (severity !== undefined) patch.severity = severity;
  if (title !== undefined) patch.title = title;
  if (incidentBody !== undefined) patch.body = incidentBody;
  if (status !== undefined) {
    patch.status = status;
    patch.resolved_at = status === 'resolved' ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Nothing to update.' },
      { status: 400 },
    );
  }

  const sb = await createServiceRoleClient();
  const { data, error } = await (
    sb.from('incidents') as unknown as {
      update: (patch: Record<string, unknown>) => {
        eq: (col: string, val: string) => {
          select: (cols: string) => {
            maybeSingle: () => Promise<{
              data: Incident | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    }
  )
    .update(patch)
    .eq('id', id)
    .select(INCIDENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[incidents/PATCH] update failed', error.message);
    return NextResponse.json(
      { ok: false, error: 'Could not update that incident.' },
      { status: 500 },
    );
  }

  if (!data) {
    return NextResponse.json(
      { ok: false, error: 'No incident with that id.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, incident: data });
}
