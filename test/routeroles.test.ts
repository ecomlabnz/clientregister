/**
 * Route × role: every route the application mounts, and who may reach it.
 *
 * ## Why this exists
 *
 * The register has 233 routes and five roles. Until 12 September 2026 three
 * tests checked that a route refused the wrong role — one of them, in
 * `security_access.test.ts`, on one delete route. A route added without a
 * permission gate, or given the wrong one, was therefore invisible: it
 * type-checked, it passed the suite, and the first sign of it was somebody with
 * the wrong role opening a page they should not have. That is the whole hole
 * this closes.
 *
 * ## How the routes are enumerated
 *
 * By building the real application and reading its router, exactly as
 * `scripts/spec.mjs` does for the specification — not by grepping the source
 * for `r.get(`. A regular expression over the source misses a route registered
 * in a loop and invents one that is commented out; `routesregistered.test.ts`
 * already exists because a route can be *written* and never reach the router.
 * Here the router is the only source of truth.
 *
 * Hono's table carries middleware and handlers in one list, in registration
 * order. Three facts make it readable:
 *
 *  - a **gate** is `requireAuth` (a named import, so it can be compared by
 *    name) or a `PermissionGate` (`core/auth.ts` attaches the permission to the
 *    function, so a closure can say what it demands);
 *  - a **handler** is any other entry on a concrete method and path;
 *  - order decides what guards what. `r.use('*', requireAuth)` mounted at `/`
 *    by the dashboard guards every path registered *after* it and nothing
 *    before, which is exactly why the registry puts the pages a client opens
 *    with no account above the dashboard. So a gate counts for a handler only
 *    when it was registered first.
 *
 * A route may have more than one handler — `GET /` is the website when nobody
 * is signed in and the dashboard when somebody is — so this works per handler
 * rather than per path. The ungated *handler* is the reachable one.
 *
 * ## What it asserts
 *
 *  1. Every handler has a permission gate in front of it, or is named in one of
 *     the two allow-lists below with a reason.
 *  2. Every allow-list entry still matches a real route (a stale exemption is
 *     an exemption nobody re-reads).
 *  3. Everything not public is behind `requireAuth`.
 *  4. No POST is gated on a read-only permission.
 *  5. The role → permission mapping is pinned.
 *  6. And then it stops declaring and starts proving: for every role and every
 *     route that role's permissions do not admit, a real signed-in request goes
 *     through the real middleware chain and must come back 403. Middleware
 *     short-circuits before the handler, so nothing is written and no handler
 *     runs.
 */

import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from '../src/core/rbac';
import { sha256Hex } from '../src/core/crypto';
import type { Role } from '../src/types';
import { fakeD1, migratedSqlite } from './support/d1';

// --- reading the router ------------------------------------------------------

type Handler = ((...args: unknown[]) => unknown) & { permission?: Permission };
interface Entry { index: number; method: string; path: string; handler: Handler }

const app = createApp() as unknown as { routes: Array<{ method: string; path: string; handler: Handler }> };
const entries: Entry[] = app.routes.map((r, index) => ({
  index, method: r.method, path: r.path, handler: r.handler,
}));

const isGate = (h: Handler): boolean => h.name === 'requireAuth' || typeof h.permission === 'string';

/** Does a middleware registered at `pattern` cover `path`? */
function covers(pattern: string, path: string): boolean {
  if (pattern === '*' || pattern === '/*') return true;
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return path === base || path.startsWith(`${base}/`);
  }
  return pattern === path;
}

interface Route {
  key: string;
  method: string;
  path: string;
  /** Where the handler sits in registration order. */
  index: number;
  /** Is `requireAuth` in front of it? */
  auth: boolean;
  /** Every permission demanded before it runs, in order. */
  permissions: Permission[];
}

/**
 * What the enumeration above steps over, kept rather than dropped.
 *
 * A route registered with `.all()`, or on a wildcard path, is not a concrete
 * method+path and cannot be swept per-role. The first version of this file
 * simply filtered those away — which meant a handler registered as
 * `r.get('/leak/*', …)` or `r.all('/leak', …)` was invisible to the one test
 * that exists to make ungated routes visible. Proved in review on 12 September
 * 2026 by adding exactly those two to a module: 26 tests still passed, and both
 * answered a signed-in `readonly` user with 200.
 *
 * So the discarded set is now asserted instead of assumed. Today it is the
 * handful of top-level middlewares and nothing else; the moment it is anything
 * else, this fails and somebody has to look.
 */
const setAside = entries
  .filter((e) => (e.method === 'ALL' || e.path.endsWith('*')) && !isGate(e.handler))
  .map((e) => `${e.method} ${e.path} — ${e.handler.name || '(anonymous)'}`);

/**
 * Middleware mounted across the whole application, named where it has one.
 *
 * Four, and all four run on every request rather than answering one:
 * the security headers, the session reader, and two anonymous wrappers. None
 * of them is a route, which is why none of them can be swept per-role. Anything
 * appearing here that *does* answer a request is a route hiding from this file.
 */
const KNOWN_SET_ASIDE = [
  'ALL /* — securityHeaders',
  'ALL /* — attachSession',
  'ALL /* — (anonymous)',
  'ALL /* — (anonymous)',
];

const routes: Route[] = entries
  .filter((e) => e.method !== 'ALL' && !e.path.endsWith('*') && !isGate(e.handler))
  .map((h) => {
    let auth = false;
    const permissions: Permission[] = [];
    for (const e of entries) {
      if (e.index >= h.index) continue;                       // registered later: it runs later
      if (e.method !== 'ALL' && e.method !== h.method) continue;
      if (!covers(e.path, h.path)) continue;
      if (e.handler.name === 'requireAuth') auth = true;
      if (typeof e.handler.permission === 'string') permissions.push(e.handler.permission);
    }
    return { key: `${h.method} ${h.path}`, method: h.method, path: h.path, index: h.index, auth, permissions };
  });

const keys = new Set(routes.map((r) => r.key));

// --- the exceptions ----------------------------------------------------------

/**
 * Reachable with no session at all. This list *is* the public surface of the
 * register, and every line of it is a decision.
 */
const PUBLIC: Record<string, string> = {
  'GET /healthz':                 'Liveness. Says whether the Worker is up and nothing about the register.',
  'POST /api/ingest/telegram':    'Telegram webhook. Authenticates by the secret header Telegram sends, not a cookie.',
  'GET /api/ingest/whatsapp':     'The one-time challenge Meta makes before it will deliver a webhook.',
  'POST /api/ingest/whatsapp':    'WhatsApp webhook. Authenticates by the Meta app-secret signature over the body.',
  'POST /api/ingest/shortcut':    'The Apple shortcut. Carries an upload token in the header; a Shortcuts action has no cookie to send.',
  'GET /setup':                   'First run. Redirects to the sign-in page the moment the register has a user.',
  'POST /setup':                  'First run. Refuses once a user exists, and needs the SETUP_TOKEN secret besides.',
  'GET /login':                   'The sign-in page. Cannot be behind sign-in.',
  'POST /login':                  'The sign-in attempt itself. Rate-limited and locks an account out.',
  'GET /login/verify':            'The two-factor challenge, reached with a session that is not yet verified.',
  'POST /login/verify':           'Answering that challenge.',
  'POST /logout':                 'Ending a session. Being signed out must never depend on being signed in.',
  'GET /':                        'The practice website, which answers for `/` when nobody is signed in. Behind it, the dashboard on the same path declares `register:read`.',
  'GET /robots.txt':              'For search engines. Public by definition.',
  'GET /sitemap.xml':             'For search engines. Public by definition.',
  'GET /llms.txt':                'For search engines. Public by definition.',
  'POST /enquiry':                'The enquiry form on the website. A member of the public is the point; it is rate-limited and creates nothing but an inquiry.',
  'GET /q/:token':                'A client reading the fee quotation sent to them. The unguessable token in the link is the whole authority — they have no account.',
  'POST /q/:token/accept':        'That same client accepting it.',
  'GET /d/:token':                'A client opening a document shared with them by link. Same reasoning as the quotation.',
};

/**
 * Signed in, but no permission beyond that. Every one of these is about *your
 * own* account rather than about the practice's records — which is why a role
 * has nothing to say about them.
 */
const SIGNED_IN_ONLY: Record<string, string> = {
  'GET /account':                         'Your own account page.',
  'POST /account/preferences':            'Your own notification preferences.',
  'POST /account/appearance':             'Your own theme and light/dark choice.',
  'POST /account/password':               'Changing your own password.',
  'GET /account/2fa':                     'Setting up your own two-factor authentication — and the page a policy redirects you to, so it can never be gated.',
  'POST /account/2fa/enable':             'Turning your own two-factor on.',
  'POST /account/2fa/disable':            'Turning your own two-factor off.',
  'POST /account/upload-tokens/revoke':   'Revoking your own upload token. Taking authority away is never gated: a person moved to "Read only" still has a token on a laptop and must be able to cancel it. The statement is scoped to the token\'s owner.',
  'POST /account/sessions/revoke':        'Signing your own other devices out.',
  'GET /help':                            'The help pages. They describe the register, name no client, and everybody who can sign in can read them.',
};

/**
 * The two paths answered by two handlers, where the first one to respond wins.
 * They are exempt from the request sweep below and from nothing else: a role
 * check on them would be a check on whichever handler happened to answer.
 */
const DOUBLE_ANSWERED = new Set(['GET /', 'GET /search']);

/** Permissions that grant no power to change anything. */
const READ_ONLY_PERMISSIONS: Permission[] = ['register:read', 'document:read', 'audit:read'];

// --- 1. the enumeration is live ---------------------------------------------

describe('the route table is read from the built application', () => {
  it('finds every route, not a handful', () => {
    expect(routes.length).toBeGreaterThan(200);
    expect(keys.size).toBeGreaterThan(200);
  });

  it('finds the gates it is looking for', () => {
    // If `requirePermission` ever stops tagging its middleware, every route
    // below looks ungated and this suite becomes noise instead of a check.
    expect(routes.filter((r) => r.permissions.length > 0).length).toBeGreaterThan(150);
    expect(routes.filter((r) => r.auth).length).toBeGreaterThan(200);
  });

  it('every permission the roles know about is used by at least one route', () => {
    const used = new Set(routes.flatMap((r) => r.permissions));
    const unused = PERMISSIONS.filter((p) => !used.has(p));
    expect(unused, `declared but no route asks for it: ${unused.join(', ')}`).toEqual([]);
  });
});

// --- 2. every route declares a gate -----------------------------------------

describe('nothing is quietly stepped over', () => {
  /**
   * The sweep can only exercise a concrete method and path, so `.all()` and
   * wildcard registrations are set aside. Setting aside is fine; doing it
   * silently is not — a handler on `GET /leak/*` would be no route at all as
   * far as this file is concerned, and that is precisely the shape somebody
   * would add by accident.
   */
  it('accounts for every registration the sweep cannot reach', () => {
    expect([...setAside].sort()).toEqual([...KNOWN_SET_ASIDE].sort());
  });
});

describe('every route declares a gate', () => {
  it('no route reaches its handler without a permission, unless it is a named exception', () => {
    const ungated = routes
      .filter((r) => r.permissions.length === 0)
      .filter((r) => !(r.key in PUBLIC) && !(r.key in SIGNED_IN_ONLY))
      .map((r) => r.key);

    expect(
      ungated,
      ungated.length === 0 ? '' :
        `\n\n  These routes have no permission gate:\n\n` +
        ungated.map((k) => `    ${k}`).join('\n') +
        `\n\n  Put a requirePermission(...) in front of each, or — if it really is` +
        `\n  meant to be reachable by anyone — add it to PUBLIC or SIGNED_IN_ONLY` +
        `\n  in test/routeroles.test.ts with one line saying why.\n`,
    ).toEqual([]);
  });

  it('no exception is stale', () => {
    const stale = [...Object.keys(PUBLIC), ...Object.keys(SIGNED_IN_ONLY)].filter((k) => !keys.has(k));
    expect(stale, `allow-listed but no longer a route: ${stale.join(', ')}`).toEqual([]);
  });

  it('every exception says why', () => {
    for (const [key, why] of [...Object.entries(PUBLIC), ...Object.entries(SIGNED_IN_ONLY)]) {
      expect(why.length, `${key} has no reason written down`).toBeGreaterThan(20);
    }
  });

  it('everything that is not public is behind requireAuth', () => {
    const open = routes.filter((r) => !r.auth && !(r.key in PUBLIC)).map((r) => r.key);
    expect(open, `no sign-in required and not in PUBLIC: ${open.join(', ')}`).toEqual([]);
  });

  it('everything in PUBLIC really is reachable without a session', () => {
    // The other direction: a route that quietly acquired `requireAuth` while
    // still sitting in PUBLIC would break a client's saved link, and the
    // allow-list would be the reason nobody noticed.
    const shut = routes.filter((r) => r.auth && r.key in PUBLIC && !DOUBLE_ANSWERED.has(r.key)).map((r) => r.key);
    expect(shut, `listed as public but behind sign-in: ${shut.join(', ')}`).toEqual([]);
  });
});

// --- 3. a gate has to be strong enough for what the route does --------------

describe('a gate matches what the route does', () => {
  it('no POST is gated only on permissions that grant no power to change anything', () => {
    const weak = routes
      .filter((r) => r.method === 'POST' && r.permissions.length > 0)
      .filter((r) => r.permissions.every((p) => READ_ONLY_PERMISSIONS.includes(p)))
      .map((r) => `${r.key} (${r.permissions.join(' + ')})`);
    expect(weak, `POST behind a read-only permission: ${weak.join(', ')}`).toEqual([]);
  });

  it('taking a copy of the whole register belongs to the owner alone', () => {
    const backup = routes.find((r) => r.key === 'POST /admin/backup');
    expect(backup?.permissions).toEqual(['backup:take']);
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[])
      .filter((role) => ROLE_PERMISSIONS[role].includes('backup:take'));
    expect(holders).toEqual(['owner']);
  });
});

// --- 4. the role → permission mapping, pinned -------------------------------

describe('what each role may do', () => {
  /**
   * Written out rather than derived, because this is the one table in the
   * register where "whatever the code says" is not an answer. Changing a line
   * here changes who can see a client file, so it should be a deliberate edit
   * in two places at once.
   */
  const EXPECTED: Record<Role, Permission[]> = {
    owner: [
      'admin:settings', 'admin:users', 'ai:run', 'audit:read', 'backup:take', 'data:test',
      'document:read', 'document:write', 'ingest:triage', 'mail:send', 'quote:write',
      'register:delete', 'register:read', 'register:write',
    ],
    admin: [
      'admin:settings', 'admin:users', 'ai:run', 'audit:read', 'data:test',
      'document:read', 'document:write', 'ingest:triage', 'mail:send', 'quote:write',
      'register:delete', 'register:read', 'register:write',
    ],
    adviser: [
      'ai:run', 'document:read', 'document:write', 'ingest:triage', 'mail:send',
      'quote:write', 'register:read', 'register:write',
    ],
    assistant: [
      'ai:run', 'document:read', 'document:write', 'ingest:triage',
      'register:read', 'register:write',
    ],
    readonly: ['document:read', 'register:read'],
  };

  const sorted = (p: readonly Permission[]) => [...p].sort();

  for (const role of Object.keys(EXPECTED) as Role[]) {
    it(`${role} holds exactly the permissions written down for it`, () => {
      expect(sorted(ROLE_PERMISSIONS[role])).toEqual(sorted(EXPECTED[role]));
    });
  }

  it('owner holds every permission there is', () => {
    expect(sorted(ROLE_PERMISSIONS.owner)).toEqual(sorted(PERMISSIONS));
  });

  it('a read-only person can reach nothing that changes a record', () => {
    const reachable = routes
      .filter((r) => r.method === 'POST')
      .filter((r) => r.permissions.length > 0)
      .filter((r) => r.permissions.every((p) => ROLE_PERMISSIONS.readonly.includes(p)))
      .map((r) => r.key);
    expect(reachable, `a POST reachable by readonly: ${reachable.join(', ')}`).toEqual([]);
  });

  it('an assistant cannot quote, bill or send email', () => {
    const barred: Permission[] = ['quote:write', 'mail:send', 'register:delete'];
    for (const p of barred) expect(ROLE_PERMISSIONS.assistant).not.toContain(p);
    const reachable = routes
      .filter((r) => r.permissions.some((p) => barred.includes(p)))
      .filter((r) => r.permissions.every((p) => ROLE_PERMISSIONS.assistant.includes(p)));
    expect(reachable.map((r) => r.key)).toEqual([]);
  });

  it('only an owner or an administrator reaches the settings and the people', () => {
    const admin = routes.filter((r) =>
      r.permissions.includes('admin:settings') || r.permissions.includes('admin:users'));
    expect(admin.length).toBeGreaterThan(15);
    for (const role of ['adviser', 'assistant', 'readonly'] as Role[]) {
      const got = admin.filter((r) => r.permissions.every((p) => ROLE_PERMISSIONS[role].includes(p)));
      expect(got.map((r) => r.key), `${role} reaches an admin route`).toEqual([]);
    }
  });
});

// --- 5. and now prove it, one request at a time -----------------------------

/**
 * A KV stand-in for the session store: the three calls `core/session.ts` makes
 * and nothing else.
 */
function fakeKv(store: Map<string, string>): KVNamespace {
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  } as unknown as KVNamespace;
}

/** A path with its parameters filled in, so the router actually matches it. */
function concrete(path: string): string {
  return path
    // `/admin/export/:key{.+\.csv}` — the pattern insists on the extension.
    .replace(/:[A-Za-z0-9_]+\{[^}]*\\\.csv[^}]*\}/g, 'sample.csv')
    .replace(/:[A-Za-z0-9_]+\{[^}]*\}/g, 'x')
    .replace(/:[A-Za-z0-9_]+/g, 'x');
}

describe('a role that lacks the permission is actually refused', () => {
  const at = '2026-09-12T00:00:00Z';
  const db = migratedSqlite();
  const sessions = new Map<string, string>();
  const env = {
    DB: fakeD1(db), SESSIONS: fakeKv(sessions), APP_ENV: 'test',
  } as unknown as Record<string, unknown>;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} };
  const origin = 'http://localhost';

  const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
  /** Role → the cookie token and CSRF token of a live, verified session. */
  const signedIn = new Map<Role, { token: string; csrf: string }>();

  it('sets up one signed-in person per role', async () => {
    for (const role of roles) {
      const id = `usr_${role}`;
      db.prepare(
        `INSERT INTO users (id, email, name, password_hash, role, status, totp_enabled, created_at, updated_at)
         VALUES (?, ?, ?, 'x', ?, 'active', 1, ?, ?)`,
      ).run(id, `${role}@example.test`, `A ${role}`, role, at, at);

      // A token the cookie carries; only its SHA-256 is ever stored, which is
      // what the real session store does.
      const token = `tok_${role}_${'0'.repeat(30)}`;
      const sid = await sha256Hex(token);
      const now = Date.now();
      sessions.set(`sess:${sid}`, JSON.stringify({
        sid, userId: id, csrf: `csrf_${role}`, createdAt: now,
        expiresAt: now + 3_600_000, verified: true, lastSeenAt: now,
      }));
      signedIn.set(role, { token, csrf: `csrf_${role}` });
    }
    expect(signedIn.size).toBe(5);
  });

  /** One request through the whole real chain, as `role`. */
  async function requestAs(role: Role, route: Route): Promise<Response> {
    const who = signedIn.get(role)!;
    const url = `${origin}${concrete(route.path)}`;
    const headers: Record<string, string> = {
      cookie: `__Host-cr_session=${who.token}`,
      origin,
    };
    if (route.method === 'GET') {
      return (app as unknown as { request: Function }).request(url, { headers }, env, ctx);
    }
    return (app as unknown as { request: Function }).request(url, {
      method: route.method,
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: who.csrf }),
    }, env, ctx);
  }

  const refusals = routes
    .filter((r) => r.permissions.length > 0 && !DOUBLE_ANSWERED.has(r.key))
    .flatMap((route) => roles
      .filter((role) => !route.permissions.every((p) => ROLE_PERMISSIONS[role].includes(p)))
      .map((role) => ({ role, route })));

  it('there is something to refuse', () => {
    expect(refusals.length).toBeGreaterThan(100);
    // Nothing is refused to the owner; every permission is theirs.
    expect(refusals.filter((x) => x.role === 'owner')).toEqual([]);
  });

  for (const role of roles) {
    const mine = refusals.filter((x) => x.role === role);
    if (mine.length === 0) continue;
    it(`${role}: the ${mine.length} route${mine.length === 1 ? '' : 's'} it may not reach all answer 403`, async () => {
      const wrong: string[] = [];
      for (const { route } of mine) {
        const res = await requestAs(role, route);
        const body = res.status === 403 ? await res.text() : '';
        // 403 *and* the permission page — a 403 from the cross-site check
        // would otherwise read as a pass.
        if (res.status !== 403 || !body.includes('not permitted')) {
          wrong.push(`${route.key} → ${res.status}${body ? ` (${body.slice(0, 40)})` : ''}`);
        }
      }
      expect(
        wrong,
        wrong.length === 0 ? '' :
          `\n\n  As ${role}, these should have been refused and were not:\n\n` +
          wrong.map((w) => `    ${w}`).join('\n') + '\n',
      ).toEqual([]);
    });
  }

  it('nobody signed out reaches anything that is not public', async () => {
    const wrong: string[] = [];
    for (const route of routes) {
      if (route.key in PUBLIC || DOUBLE_ANSWERED.has(route.key)) continue;
      const init = route.method === 'GET'
        ? { headers: { origin } }
        : {
            method: route.method,
            headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({}),
          };
      const res = await (app as unknown as { request: Function })
        .request(`${origin}${concrete(route.path)}`, init, env, ctx);
      // Sent to the sign-in page, with where they were going.
      if (res.status !== 302 || !(res.headers.get('location') ?? '').startsWith('/login')) {
        wrong.push(`${route.key} → ${res.status} ${res.headers.get('location') ?? ''}`);
      }
    }
    expect(
      wrong,
      wrong.length === 0 ? '' :
        `\n\n  With no session at all, these did not send the visitor to sign in:\n\n` +
        wrong.map((w) => `    ${w}`).join('\n') + '\n',
    ).toEqual([]);
  });
});
