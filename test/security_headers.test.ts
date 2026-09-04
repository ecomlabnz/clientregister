/**
 * The hardening applied to every response and every state-changing request.
 *
 * These are asserted behaviourally — through the middleware as a request runs
 * it — not by reading the source, so a header that is dropped or a check that
 * is loosened fails here rather than in front of a signed-in register.
 *
 * To add a guarantee: add the header to REQUIRED_HEADERS or the directive to
 * REQUIRED_CSP, or add a row to the CSRF matrix. The point of the tables is
 * that the next person can see the whole policy in one place.
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { AppContext, SessionData } from '../src/types';
import { securityHeaders, csrfProtection } from '../src/core/security';

/** Every response header the browser is entitled to, and what it must say. */
const REQUIRED_HEADERS: Record<string, (v: string | null) => boolean> = {
  'content-security-policy': (v) => !!v,
  'x-content-type-options': (v) => v === 'nosniff',
  'referrer-policy': (v) => v === 'same-origin',
  'x-frame-options': (v) => v === 'DENY',
  'cross-origin-opener-policy': (v) => v === 'same-origin',
  'cross-origin-resource-policy': (v) => v === 'same-origin',
  'strict-transport-security': (v) => !!v && /max-age=\d+/.test(v) && v.includes('includeSubDomains'),
  'permissions-policy': (v) => !!v && v.includes('camera=()'),
  'x-request-id': (v) => !!v,
};

/**
 * Directives the content security policy must carry. `'none'` defaults and the
 * absence of `'unsafe-inline'`/`'unsafe-eval'` are the load-bearing parts: they
 * are the second wall behind the email sanitiser, and a stray `'unsafe-inline'`
 * in script-src would quietly demolish it.
 */
const REQUIRED_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];

function headersApp() {
  const app = new Hono<AppContext>();
  app.use('*', securityHeaders);
  app.get('/', (c) => c.text('ok'));
  return app;
}

describe('security headers on every response', () => {
  it('sets each required header', async () => {
    const res = await headersApp().request('/');
    for (const [name, ok] of Object.entries(REQUIRED_HEADERS)) {
      expect(ok(res.headers.get(name)), `${name} = ${res.headers.get(name)}`).toBe(true);
    }
  });

  it('carries every required CSP directive', async () => {
    const csp = (await headersApp().request('/')).headers.get('content-security-policy') ?? '';
    for (const directive of REQUIRED_CSP) {
      expect(csp, `missing: ${directive}`).toContain(directive);
    }
  });

  it('leaves a stricter policy a route set for itself', async () => {
    // The two file downloads hand back something that came from outside, and
    // set `default-src 'none'; sandbox` on it. This used to be overwritten
    // with the page policy — which permits same-origin script — on exactly the
    // responses that most needed it not to be.
    const app = new Hono<AppContext>();
    app.use('*', securityHeaders);
    app.get('/file', (c) => new Response('bytes', {
      headers: { 'content-security-policy': "default-src 'none'; sandbox" },
    }));
    const res = await app.request('/file');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    // Everything else the middleware adds is still added.
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it("never weakens script-src with 'unsafe-inline' or 'unsafe-eval'", async () => {
    const csp = (await headersApp().request('/')).headers.get('content-security-policy') ?? '';
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });
});

// --- CSRF -------------------------------------------------------------------

const TOKEN = 'the-session-csrf-token';

function csrfApp(opts: { session?: boolean; skip?: string[] } = {}) {
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    if (opts.session !== false) {
      c.set('session', { sid: 's', userId: 'u', csrf: TOKEN,
        createdAt: 0, expiresAt: Date.now() + 1e7, verified: true } as SessionData);
    } else {
      c.set('session', null);
    }
    await next();
  });
  app.use('*', csrfProtection(opts.skip ?? ['/api/ingest/telegram']));
  app.get('/x', (c) => c.text('read'));
  app.post('/x', (c) => c.text('wrote'));
  app.post('/api/ingest/telegram', (c) => c.text('webhook'));
  return app;
}

const origin = 'http://register.test';
const form = (token?: string) =>
  new URLSearchParams(token === undefined ? {} : { _csrf: token });

async function send(app: Hono<AppContext>, path: string, init: RequestInit) {
  return app.request(`${origin}${path}`, init);
}

describe('CSRF defence on state-changing requests', () => {
  it('lets safe methods through untouched', async () => {
    const res = await send(csrfApp(), '/x', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('rejects a cross-origin POST', async () => {
    const res = await send(csrfApp(), '/x', {
      method: 'POST',
      headers: { origin: 'http://evil.test', 'content-type': 'application/x-www-form-urlencoded' },
      body: form(TOKEN),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a same-origin POST with no token', async () => {
    const res = await send(csrfApp(), '/x', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: form(),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a same-origin POST with the wrong token', async () => {
    const res = await send(csrfApp(), '/x', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: form('not-the-token'),
    });
    expect(res.status).toBe(403);
  });

  it('accepts a same-origin POST carrying the session token', async () => {
    const res = await send(csrfApp(), '/x', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: form(TOKEN),
    });
    expect(res.status).toBe(200);
  });

  it('lets a signed-out same-origin POST through (no session to protect)', async () => {
    const res = await send(csrfApp({ session: false }), '/x', {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: form(),
    });
    expect(res.status).toBe(200);
  });

  it('exempts a webhook path, which authenticates by signature', async () => {
    const res = await send(csrfApp(), '/api/ingest/telegram', {
      method: 'POST',
      headers: { origin: 'http://telegram.test', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
  });

  it('accepts sec-fetch-site: same-origin when Origin is absent', async () => {
    const res = await send(csrfApp(), '/x', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
      body: form(TOKEN),
    });
    expect(res.status).toBe(200);
  });
});
