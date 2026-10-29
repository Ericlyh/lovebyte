import { timingSafeEqual } from 'node:crypto';

/**
 * Auth for the analytics report route (OOP-6716).
 *
 * The app has no admin role — `profiles` carries no role column and
 * there is no admin UI — and the operator on call is the founder, not
 * a registered account. So the report is guarded by the same
 * server-only bearer token the status-page admin routes use,
 * `INCIDENT_ADMIN_TOKEN`.
 *
 * One operator, one token: a second token for the same human would be
 * a second thing to rotate and a second way to leak.
 *
 * Fails CLOSED: if the token is not configured the route returns 503
 * rather than serving the report to anyone. An unset env var must
 * never mean "no auth required".
 */
export type AnalyticsAdminAuth =
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

export function authorizeAnalyticsAdmin(request: Request): AnalyticsAdminAuth {
  const expected = process.env.INCIDENT_ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error:
        'INCIDENT_ADMIN_TOKEN is not configured on this deployment — the analytics report is disabled.',
    };
  }

  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';

  if (!presented || !constantTimeEquals(presented, expected)) {
    return { ok: false, status: 401, error: 'Invalid admin token.' };
  }

  return { ok: true };
}
