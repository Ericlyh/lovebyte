import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { probeRoute } from './http-probe.mjs';

// The budget is small so the fake server's delays stay well clear of it.
const ROUTES_MIN = 200;
const ROUTES_MAX = 399;
const ROUTE_MAX_MS = 300;
const SLOW_MS = 700;

let server;
let base;
const hits = new Map();

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = req.url;
    const n = (hits.get(path) ?? 0) + 1;
    hits.set(path, n);

    const respond = () => {
      if (path === '/missing') {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('nope');
        return;
      }
      if (path === '/broken') {
        res.writeHead(500, { 'content-type': 'text/html' });
        res.end('boom');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>ok</html>');
    };

    // /cold is slow on the FIRST hit only (the cold boot), /slow is slow
    // on every hit (a slow dependency).
    const delay = path === '/slow' || (path === '/cold' && n === 1) ? SLOW_MS : 0;
    setTimeout(respond, delay);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('probeRoute', () => {
  it('passes a fast route without a retry', async () => {
    const probe = await probeRoute('/fast', {
      base,
      routesMin: ROUTES_MIN,
      routesMax: ROUTES_MAX,
      routeMaxMs: ROUTE_MAX_MS,
    });
    expect(probe.verdict).toBe('ok');
    expect(probe.status).toBe(200);
    expect(probe.ms).toBeLessThanOrEqual(ROUTE_MAX_MS);
    expect(hits.get('/fast')).toBe(1);
  });

  it('treats a slow FIRST hit as a cold boot, not as a slow route', async () => {
    const probe = await probeRoute('/cold', {
      base,
      routesMin: ROUTES_MIN,
      routesMax: ROUTES_MAX,
      routeMaxMs: ROUTE_MAX_MS,
    });
    expect(probe.verdict).toBe('cold');
    expect(probe.firstMs).toBeGreaterThan(ROUTE_MAX_MS);
    expect(probe.ms).toBeLessThanOrEqual(ROUTE_MAX_MS);
    expect(probe.message).toContain('cold-start /cold');
    expect(hits.get('/cold')).toBe(2);
  });

  it('still fails a route that is slow on every request', async () => {
    const probe = await probeRoute('/slow', {
      base,
      routesMin: ROUTES_MIN,
      routesMax: ROUTES_MAX,
      routeMaxMs: ROUTE_MAX_MS,
    });
    expect(probe.verdict).toBe('slow');
    expect(probe.ms).toBeGreaterThan(ROUTE_MAX_MS);
    expect(probe.message).toContain('too slow to serve');
    expect(hits.get('/slow')).toBe(2);
  });

  it('fails a route that does not answer 200', async () => {
    const probe = await probeRoute('/missing', {
      base,
      routesMin: ROUTES_MIN,
      routesMax: ROUTES_MAX,
      routeMaxMs: ROUTE_MAX_MS,
    });
    expect(probe.verdict).toBe('status');
    expect(probe.status).toBe(404);
    expect(probe.message).toContain('expected 200-399');
  });

  it('fails a route that answers 500', async () => {
    const probe = await probeRoute('/broken', {
      base,
      routesMin: ROUTES_MIN,
      routesMax: ROUTES_MAX,
      routeMaxMs: ROUTE_MAX_MS,
    });
    expect(probe.verdict).toBe('status');
    expect(probe.status).toBe(500);
  });

  it('fails a route that cannot be reached at all', async () => {
    const probe = await probeRoute('/', {
      base: 'http://this-host-does-not-exist.invalid',
      routesMin: ROUTES_MIN,
      routesMax: ROUTES_MAX,
      routeMaxMs: ROUTE_MAX_MS,
    });
    expect(probe.verdict).toBe('unreachable');
    expect(probe.message).toContain('unreachable');
  });
});
