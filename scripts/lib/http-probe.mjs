// The HTTP probe for the readiness gate (OOP-5816).
//
// Exported on its own so the decision this probe makes — "is this route
// genuinely slow, or did the first hit just pay the cold boot?" — can be
// unit-tested without booting Chrome for the Lighthouse pass.
//
// Why the retry (OOP-6701):
//
//   The gate runs once a day, so whichever route it probes first is the
//   first request after the function slept. That first request pays the
//   cold lambda boot (~4s on the landing page) and the cost is paid ONCE
//   per idle period. A route with a slow dependency pays it on EVERY
//   request — that is the failure the budget exists to catch (the
//   /browse blank-page bug of OOP-5816).
//
//   So: when the first hit misses the budget, hit the route again. If it
//   misses on the retry too, it is genuinely slow and the gate fails. If
//   only the first hit missed it, the first hit was the cold boot — that
//   is a note, not a gap.
//
// The two failure modes are told apart by a retry rather than by a bigger
// budget, so the gate still fails on a route that is slow every time.

/**
 * Probe one critical route.
 *
 * @returns {Promise<{
 *   verdict: 'ok' | 'cold' | 'status' | 'slow' | 'unreachable',
 *   status: number,        // the status of the request that counts
 *   ms: number,            // how long the request that counts took
 *   firstMs: number,       // how long the first hit took
 *   message: string,       // why it failed, or what the cold boot cost
 * }>}
 */
export async function probeRoute(path, { base, routesMin, routesMax, routeMaxMs }) {
  const started = Date.now();
  let first;
  try {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    await res.text();
    first = { status: res.status, ms: Date.now() - started };
  } catch (err) {
    const ms = Date.now() - started;
    return {
      verdict: 'unreachable',
      status: 0,
      ms,
      firstMs: ms,
      message: `${path} unreachable — ${err.message}`,
    };
  }

  // A critical route must serve. 4xx and 5xx are failures — the gate used
  // to test `status < 200`, which let a 404 or a 500 on a critical route
  // pass as healthy (OOP-6701).
  if (first.status < routesMin || first.status > routesMax) {
    return {
      verdict: 'status',
      status: first.status,
      ms: first.ms,
      firstMs: first.ms,
      message: `${path} returned ${first.status} (expected ${routesMin}-${routesMax})`,
    };
  }

  if (first.ms <= routeMaxMs) {
    return { verdict: 'ok', status: first.status, ms: first.ms, firstMs: first.ms, message: '' };
  }

  // The first hit missed the budget. Is that the cold boot, or a route
  // that is slow on every request? Retry and find out.
  const retryStarted = Date.now();
  let retry;
  try {
    const res = await fetch(`${base}${path}`, { redirect: 'manual' });
    await res.text();
    retry = { status: res.status, ms: Date.now() - retryStarted };
  } catch (err) {
    const ms = Date.now() - retryStarted;
    return {
      verdict: 'unreachable',
      status: 0,
      ms,
      firstMs: first.ms,
      message: `${path} unreachable on retry — ${err.message}`,
    };
  }

  if (retry.status < routesMin || retry.status > routesMax) {
    return {
      verdict: 'status',
      status: retry.status,
      ms: retry.ms,
      firstMs: first.ms,
      message: `${path} returned ${retry.status} on retry (expected ${routesMin}-${routesMax})`,
    };
  }

  if (retry.ms > routeMaxMs) {
    return {
      verdict: 'slow',
      status: retry.status,
      ms: retry.ms,
      firstMs: first.ms,
      message: `${path} served in ${retry.ms}ms on retry (expected <= ${routeMaxMs}ms) — too slow to serve`,
    };
  }

  return {
    verdict: 'cold',
    status: retry.status,
    ms: retry.ms,
    firstMs: first.ms,
    message: `cold-start ${path}: first hit ${first.ms}ms, retry ${retry.ms}ms — the first hit paid the cold boot, the retry served within budget`,
  };
}
