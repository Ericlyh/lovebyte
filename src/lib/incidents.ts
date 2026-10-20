import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Shared pieces of the status-page admin route (OOP-6156).
 *
 * The public `/status` page reads `public.incidents` through the anon
 * PostgREST helper. This module holds the write side: the auth check
 * the on-call operator passes, and the Zod schemas that mirror the
 * table's CHECK constraints so a bad payload is rejected at the edge
 * instead of blowing up as a Postgres constraint violation.
 *
 * Why a shared secret rather than a user session? The app has no admin
 * role — `profiles` carries no role column and there is no admin UI —
 * and the operator on call is the founder, not a registered account.
 * A bearer token set as `INCIDENT_ADMIN_TOKEN` is the smallest thing
 * that does not invent a half-built permission system. It is a
 * server-only env var; it is never exposed to the browser.
 */

/** Mirrors the `public.incident_severity` enum (migration 0009). */
export const incidentSeveritySchema = z.enum([
  'operational',
  'maintenance',
  'degraded',
  'outage',
]);
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>;

/** Mirrors the `status` CHECK constraint on `public.incidents`. */
export const incidentStatusSchema = z.enum([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;

/** The columns the admin routes read back. Matches the `/status` select. */
export const INCIDENT_COLUMNS =
  'id,severity,title,body,status,created_at,updated_at,resolved_at';

export type Incident = {
  id: string;
  severity: IncidentSeverity;
  title: string;
  body: string | null;
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

/**
 * Free-form incident body. `null` and `''` both normalise to `null`
 * so the column keeps its "no body" meaning instead of an empty string.
 */
const incidentBodySchema = z
  .string()
  .trim()
  .max(4000, 'body is too long (4000 chars max).')
  .nullish()
  .transform((v) => (v ? v : null));

export const incidentCreateSchema = z.object({
  severity: incidentSeveritySchema,
  title: z
    .string()
    .trim()
    .min(1, 'title cannot be empty.')
    .max(200, 'title is too long (200 chars max).'),
  body: incidentBodySchema,
  status: incidentStatusSchema.default('investigating'),
});
export type IncidentCreateInput = z.input<typeof incidentCreateSchema>;
export type IncidentCreatePayload = z.output<typeof incidentCreateSchema>;

export const incidentUpdateSchema = z.object({
  severity: incidentSeveritySchema.optional(),
  title: z
    .string()
    .trim()
    .min(1, 'title cannot be empty.')
    .max(200, 'title is too long (200 chars max).')
    .optional(),
  body: incidentBodySchema.optional(),
  status: incidentStatusSchema.optional(),
});
export type IncidentUpdatePayload = z.output<typeof incidentUpdateSchema>;

export type IncidentAdminAuth =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are
 * compared first and the function short-circuits. That leaks the token
 * length, which is not the secret here — the token value is, and that
 * is what the constant-time path protects.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Authorise an incident-admin request.
 *
 * Fails CLOSED: if `INCIDENT_ADMIN_TOKEN` is not configured the route
 * returns 503 rather than accepting the write. An unset env var must
 * never mean "no auth required".
 */
export function authorizeIncidentAdmin(request: Request): IncidentAdminAuth {
  const expected = process.env.INCIDENT_ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error:
        'INCIDENT_ADMIN_TOKEN is not configured on this deployment — incident writes are disabled.',
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';

  if (!presented || !constantTimeEquals(presented, expected)) {
    return { ok: false, status: 401, error: 'Invalid incident admin token.' };
  }

  return { ok: true };
}
