/**
 * Trusting a machine with the second factor.
 *
 * **Asked for on 12 September 2026:** *"allow for 40 days of authentication
 * memory on a machine, not every time. it is annoying. so the machine should
 * become trusted and only reset on the 41st day"*
 *
 * What is built is a bearer credential in a cookie, which is the shape of fault
 * 43 — *a bearer credential outlives the decision that allowed it, so the
 * permission is checked where it is spent, not only where it is issued.* The
 * cookie sits on a laptop for forty days, through a suspension, a password
 * change and a two-factor reset that nobody re-runs it against. So most of what
 * is proved here is about the moment it is **presented**, not the moment it is
 * made. In order of what would hurt:
 *
 *  - **It is only ever a stand-in for the code.** The password is asked for
 *    every time, the cookie alone opens nothing, and it neither restores a
 *    session nor lengthens one.
 *  - **Every condition is re-read from the database on presentation**: the row
 *    is live, the deadline has not passed, the person is still active, and they
 *    still have the *same* two-factor switched on.
 *  - **It dies when the ground moves** — a password change, a suspension, an
 *    administrator's reset, two-factor off or on again, a recovery code.
 *  - **The deadline is absolute.** Using a machine does not buy it another day,
 *    and the database refuses to move the date whoever asks.
 *  - **It weakens nothing else**: the rate limiter, the lockout and the audit
 *    log all behave as they did.
 *
 * The database's own refusals are attacked directly, with SQL, rather than
 * through the application — the rule in CLAUDE.md.
 *
 * All data invented; real client data never enters this repository.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { fakeD1, fakeUser, migratedSqlite } from './support/d1';
import type { AppContext, SessionData, User } from '../src/types';
import { authModule } from '../src/modules/auth';
import { adminModule } from '../src/modules/admin';
import {
  TRUSTED_DEVICE_DEFAULT_DAYS, TRUSTED_DEVICE_MAX_DAYS, TRUST_COOKIE,
  createTrustedDevice, parseTrustToken, revokeAllTrustedDevices, revokeTrustedDevice,
  trustedDeviceDays, trustedDevicesFor, verifyTrustedDevice,
} from '../src/core/trusteddevices';
import { generateTotpSecret, hashPassword, sha256Hex, totpCode } from '../src/core/crypto';

const AT = '2026-09-12T09:00:00Z';
const PASSWORD = 'a long enough password';
/** Hashed once: PBKDF2 is deliberately slow, and every test wants the same account. */
const PASSWORD_HASH = await hashPassword(PASSWORD);
const TOTP_SECRET = generateTotpSecret();
const OTHER_SECRET = generateTotpSecret();

const USER: User = fakeUser({
  id: 'u_trust', email: 'adviser@practice.test', name: 'AN ADVISER', role: 'admin', totp_enabled: 1,
});

/** KV, in a Map, with the calls the rate limiter and the session store make. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
}

interface Mounted {
  db: any;
  env: { DB: D1Database } & Record<string, unknown>;
  state: { user: User | null; session: SessionData | null };
  request(path: string, init?: RequestInit): Promise<Response>;
  post(path: string, form?: Record<string, string>, cookie?: string): Promise<Response>;
  row<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T | null;
  rows<T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[];
  count(sql: string, ...p: unknown[]): number;
}

/**
 * The auth module on a bare app, with whoever is signed in held in `state` so a
 * test can change it between requests. The sign-in routes run with nobody
 * signed in, which is the honest shape.
 */
function mountAuth(opts: { totpEnabled?: boolean; status?: string } = {}): Mounted {
  const db = migratedSqlite();
  const kv = fakeKv();
  const env = {
    DB: fakeD1(db), SESSIONS: kv, APP_ENV: 'test', APP_NAME: 'Register',
  } as unknown as { DB: D1Database } & Record<string, unknown>;

  const enabled = opts.totpEnabled === false ? 0 : 1;
  db.prepare(
    `INSERT INTO users (id,email,name,password_hash,role,status,totp_enabled,totp_secret,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(USER.id, USER.email, USER.name, PASSWORD_HASH, USER.role, opts.status ?? 'active',
    enabled, enabled ? TOTP_SECRET : null, AT, AT);

  const state: { user: User | null; session: SessionData | null } = { user: null, session: null };
  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('user', state.user);
    c.set('session', state.session);
    c.set('requestId', 'req_test');
    c.set('nonce', 'nonce_test');
    await next();
  });
  authModule.register(app);

  const origin = 'http://localhost';
  const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.request(`${origin}${path}`, init, env as any);

  const post = async (path: string, form: Record<string, string> = {}, cookie?: string): Promise<Response> =>
    request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
        'user-agent': 'A Browser on a Laptop',
        ...(cookie ? { cookie } : {}),
      },
      body: new URLSearchParams({ _csrf: 'test-csrf-token', ...form }),
    });

  const row = <T = Record<string, unknown>>(sql: string, ...p: unknown[]): T | null =>
    ((db.prepare(sql) as any).get(...(p as any[])) as T | undefined) ?? null;
  const rows = <T = Record<string, unknown>>(sql: string, ...p: unknown[]): T[] =>
    (db.prepare(sql) as any).all(...(p as any[])) as T[];
  const count = (sql: string, ...p: unknown[]): number => (row<{ n: number }>(sql, ...p)?.n) ?? 0;

  return { db, env, state, request, post, row, rows, count };
}

/** An unverified session, the state a correct password leaves behind. */
function unverifiedSession(): SessionData {
  return {
    sid: 's_trust', userId: USER.id, csrf: 'test-csrf-token',
    createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, verified: false,
  };
}

function cookieValue(res: Response, name: string): string | null {
  for (const raw of res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']) {
    const m = new RegExp(`(?:^|, )${name}=([^;]*)`).exec(raw);
    if (m) return m[1] ?? null;
  }
  return null;
}

function cookieAttrs(res: Response, name: string): string | null {
  for (const raw of res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']) {
    if (raw.includes(`${name}=`)) return raw;
  }
  return null;
}

/** Sign in with the right password, carrying whatever cookie is given. */
const signIn = (h: Mounted, cookie?: string) =>
  h.post('/login', { email: USER.email, password: PASSWORD }, cookie);

/** A trusted machine, made the way the application makes one. */
async function trust(h: Mounted, over: { days?: number; totpSecret?: string } = {}) {
  return createTrustedDevice(h.env as any, {
    userId: USER.id,
    totpSecret: over.totpSecret ?? TOTP_SECRET,
    days: over.days ?? TRUSTED_DEVICE_DEFAULT_DAYS,
  });
}

// --- 1. What the database refuses, attacked with SQL --------------------------

describe('the database keeps the rules, not the route that happens to write the row', () => {
  const HASH = 'pbkdf2-sha256$1x100000$AAAA$BBBB';
  const FINGERPRINT = 'a'.repeat(64);

  function schema() {
    const db = migratedSqlite();
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','active','${AT}','${AT}')`);
    return db;
  }

  const insert = (db: any, over: Record<string, unknown> = {}) => {
    const r: Record<string, any> = {
      id: 'td1', user_id: 'u1', selector: 'ABCDEFGHIJKL', secret_hash: HASH,
      totp_fingerprint: FINGERPRINT, created_at: '2026-09-12T00:00:00Z',
      expires_at: '2026-10-22T00:00:00Z', ...over,
    };
    db.prepare(
      `INSERT INTO trusted_devices (id,user_id,selector,secret_hash,totp_fingerprint,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(r.id, r.user_id, r.selector, r.secret_hash, r.totp_fingerprint, r.created_at, r.expires_at);
  };

  it('refuses a row whose secret is not a hash', () => {
    const db = schema();
    expect(() => insert(db, { secret_hash: 'rt_the_whole_thing_in_the_clear' }))
      .toThrow(/stored hashed/);
  });

  it('refuses a row with no deadline at all', () => {
    const db = schema();
    expect(() => db.prepare(
      `INSERT INTO trusted_devices (id,user_id,selector,secret_hash,totp_fingerprint,created_at,expires_at)
       VALUES ('td','u1','ABCDEFGHIJKL',?,?,?,NULL)`,
    ).run(HASH, FINGERPRINT, AT)).toThrow(/NOT NULL/);
  });

  it('refuses a deadline that is not after the moment it was granted', () => {
    const db = schema();
    expect(() => insert(db, { expires_at: '2026-09-11T00:00:00Z' })).toThrow(/CHECK/);
  });

  it('refuses more than the ceiling, and allows exactly the ceiling', () => {
    const db = schema();
    // 91 days after 12 September 2026.
    expect(() => insert(db, { expires_at: '2026-12-12T00:00:00Z' }))
      .toThrow(/longer than 90 days/);
    // 90 days exactly.
    insert(db, { id: 'td_ok', selector: 'BBBBBBBBBBBB', expires_at: '2026-12-11T00:00:00Z' });
    expect((db.prepare(`SELECT COUNT(*) n FROM trusted_devices`) as any).get().n).toBe(1);
  });

  it('refuses to move the deadline — the whole of "only reset on the 41st day"', () => {
    const db = schema();
    insert(db);
    expect(() => db.exec(`UPDATE trusted_devices SET expires_at = '2027-01-01T00:00:00Z' WHERE id='td1'`))
      .toThrow(/was always going to expire/);
  });

  it('refuses to give a machine a new secret or a new selector', () => {
    const db = schema();
    insert(db);
    expect(() => db.exec(`UPDATE trusted_devices SET secret_hash = 'pbkdf2-sha256$x' WHERE id='td1'`))
      .toThrow(/cannot be given a new secret/);
    expect(() => db.exec(`UPDATE trusted_devices SET selector = 'ZZZZZZZZZZZZ' WHERE id='td1'`))
      .toThrow(/cannot be given a new secret/);
  });

  it('refuses to un-forget a machine', () => {
    const db = schema();
    insert(db);
    db.exec(`UPDATE trusted_devices SET revoked_at = '${AT}' WHERE id='td1'`);
    expect(() => db.exec(`UPDATE trusted_devices SET revoked_at = NULL WHERE id='td1'`))
      .toThrow(/stays forgotten/);
  });

  it('refuses to move a machine to another person', () => {
    const db = schema();
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u2','c@d.test','B','x','owner','active','${AT}','${AT}')`);
    insert(db);
    expect(() => db.exec(`UPDATE trusted_devices SET user_id = 'u2' WHERE id='td1'`))
      .toThrow(/belongs to the person who trusted it/);
  });

  it('refuses a selector of the wrong length and a fingerprint that is not one', () => {
    const db = schema();
    expect(() => insert(db, { selector: 'TOOSHORT' })).toThrow(/CHECK/);
    expect(() => insert(db, { totp_fingerprint: 'not a sha256' })).toThrow(/CHECK/);
  });

  it('refuses to reduce the count of uses', () => {
    const db = schema();
    insert(db);
    db.exec(`UPDATE trusted_devices SET uses = 4 WHERE id='td1'`);
    expect(() => db.exec(`UPDATE trusted_devices SET uses = 1 WHERE id='td1'`))
      .toThrow(/cannot be reduced/);
  });

  it('takes a person’s trusted machines with them when the account goes', () => {
    const db = schema();
    insert(db);
    db.exec(`DELETE FROM users WHERE id = 'u1'`);
    expect((db.prepare(`SELECT COUNT(*) n FROM trusted_devices`) as any).get().n).toBe(0);
  });
});

// --- 2. Judged at the moment it is spent (fault 43) --------------------------

describe('every condition is read fresh when the credential is presented', () => {
  it('accepts a live machine belonging to an active person with the same authenticator', async () => {
    const h = mountAuth();
    const made = await trust(h);
    const check = await verifyTrustedDevice(h.env as any, made.token);
    expect(check.ok).toBe(true);
    expect(check.ok && check.userId).toBe(USER.id);
  });

  it('refuses one that has been forgotten', async () => {
    const h = mountAuth();
    const made = await trust(h);
    h.db.exec(`UPDATE trusted_devices SET revoked_at = '${AT}' WHERE id = '${made.row.id}'`);
    expect((await verifyTrustedDevice(h.env as any, made.token)).ok).toBe(false);
  });

  it('refuses one whose deadline has passed, whatever the cookie thinks', async () => {
    const h = mountAuth();
    // Planted rather than made: the database refuses to move a deadline, which
    // is the point, so an expired row has to be born expired.
    const selector = 'EXPIREDROW12';
    const secret = 'S'.repeat(43);
    h.db.prepare(
      `INSERT INTO trusted_devices (id,user_id,selector,secret_hash,totp_fingerprint,created_at,expires_at)
       VALUES ('td_old',?,?,?,?,?,?)`,
    ).run(USER.id, selector, await hashPassword(secret), await sha256Hex(TOTP_SECRET),
      '2026-06-01T00:00:00Z', '2026-07-11T00:00:00Z');

    expect((await verifyTrustedDevice(h.env as any, `rt_${selector}${secret}`)).ok).toBe(false);
  });

  it('accepts a machine whose deadline is still a minute away', async () => {
    const h = mountAuth();
    const selector = 'ALMOSTGONE12';
    const secret = 'T'.repeat(43);
    h.db.prepare(
      `INSERT INTO trusted_devices (id,user_id,selector,secret_hash,totp_fingerprint,created_at,expires_at)
       VALUES ('td_soon',?,?,?,?,?,?)`,
    ).run(USER.id, selector, await hashPassword(secret), await sha256Hex(TOTP_SECRET),
      new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 60_000).toISOString());

    expect((await verifyTrustedDevice(h.env as any, `rt_${selector}${secret}`)).ok).toBe(true);
  });

  it('refuses one belonging to a suspended person', async () => {
    const h = mountAuth();
    const made = await trust(h);
    h.db.exec(`UPDATE users SET status = 'suspended' WHERE id = '${USER.id}'`);
    expect((await verifyTrustedDevice(h.env as any, made.token)).ok).toBe(false);
  });

  it('refuses one when two-factor has been switched off', async () => {
    const h = mountAuth();
    const made = await trust(h);
    h.db.exec(`UPDATE users SET totp_enabled = 0 WHERE id = '${USER.id}'`);
    expect((await verifyTrustedDevice(h.env as any, made.token)).ok).toBe(false);
  });

  it('refuses one when two-factor is on but under a different authenticator', async () => {
    // Removed and added again: the row survives, `totp_enabled` is 1 again, and
    // the secret is new. Without the fingerprint this would still be accepted.
    const h = mountAuth();
    const made = await trust(h);
    h.db.exec(`UPDATE users SET totp_secret = '${OTHER_SECRET}' WHERE id = '${USER.id}'`);
    expect((await verifyTrustedDevice(h.env as any, made.token)).ok).toBe(false);
  });

  it('refuses a right selector with a wrong secret, an unknown selector, and nonsense', async () => {
    const h = mountAuth();
    const made = await trust(h);
    const parts = parseTrustToken(made.token)!;
    for (const presented of [
      `rt_${parts.selector}${'A'.repeat(43)}`,
      `rt_${'B'.repeat(12)}${'C'.repeat(43)}`,
      'rt_short',
      'not a credential at all',
      '',
    ]) {
      expect((await verifyTrustedDevice(h.env as any, presented)).ok, presented.slice(0, 20)).toBe(false);
    }
  });

  it('never holds the secret — what is stored is a hash, and only a hash', async () => {
    const h = mountAuth();
    const made = await trust(h);
    const parts = parseTrustToken(made.token)!;
    const stored = h.row<{ secret_hash: string; totp_fingerprint: string }>(
      `SELECT secret_hash, totp_fingerprint FROM trusted_devices`)!;
    expect(stored.secret_hash.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(stored.secret_hash).not.toContain(parts.secret);
    // Nor the authenticator's secret, which would be worth more than the cookie.
    expect(stored.totp_fingerprint).not.toContain(TOTP_SECRET);
    const everything = JSON.stringify(h.rows(`SELECT * FROM trusted_devices`));
    expect(everything).not.toContain(parts.secret);
    expect(everything).not.toContain(TOTP_SECRET);
  });
});

// --- 3. Signing in on a trusted machine --------------------------------------

describe('signing in on a machine that has been trusted', () => {
  it('skips the code and lands on the register, with the session already verified', async () => {
    const h = mountAuth();
    const made = await trust(h);

    const res = await signIn(h, `${TRUST_COOKIE}=${made.token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).not.toContain('/login/verify');

    const sess = h.row<{ id: string }>(`SELECT id FROM session_records`);
    expect(sess).not.toBeNull();
    const stored = JSON.parse([...(h.env.SESSIONS as any).store.values()]
      .find((v: string) => v.includes('"sid"')) as string);
    expect(stored.verified).toBe(true);
  });

  it('asks for the code on a machine with no cookie', async () => {
    const h = mountAuth();
    await trust(h);
    const res = await signIn(h);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login/verify');
  });

  it('still demands the password — the cookie on its own opens nothing', async () => {
    const h = mountAuth();
    const made = await trust(h);
    const res = await h.post('/login',
      { email: USER.email, password: 'the wrong password entirely' },
      `${TRUST_COOKIE}=${made.token}`);
    expect(res.status).toBe(401);
    expect(h.count(`SELECT COUNT(*) AS n FROM session_records`)).toBe(0);
    // And the failure was counted against the account, exactly as before.
    expect(h.row<{ failed_logins: number }>(`SELECT failed_logins FROM users`)?.failed_logins).toBe(1);
  });

  it('is refused for the person it does not belong to, and their cookie is left alone', async () => {
    const h = mountAuth();
    h.db.prepare(
      `INSERT INTO users (id,email,name,password_hash,role,status,totp_enabled,totp_secret,created_at,updated_at)
       VALUES ('u_other','other@practice.test','SOMEBODY ELSE',?,'admin','active',1,?,?,?)`,
    ).run(PASSWORD_HASH, TOTP_SECRET, AT, AT);
    const made = await createTrustedDevice(h.env as any, {
      userId: 'u_other', totpSecret: TOTP_SECRET, days: 40,
    });

    const res = await h.post('/login',
      { email: USER.email, password: PASSWORD }, `${TRUST_COOKIE}=${made.token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login/verify');
    // Still theirs: signing in as somebody else does not make the owner of the
    // machine type a code tomorrow.
    expect(cookieAttrs(res, TRUST_COOKIE)).toBeNull();
    expect(h.row<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM trusted_devices`)?.revoked_at).toBeNull();
  });

  it('takes a dead cookie off the machine rather than leaving it to be refused daily', async () => {
    const h = mountAuth();
    const made = await trust(h);
    h.db.exec(`UPDATE trusted_devices SET revoked_at = '${AT}' WHERE id = '${made.row.id}'`);

    const res = await signIn(h, `${TRUST_COOKIE}=${made.token}`);
    expect(res.headers.get('location')).toContain('/login/verify');
    const cleared = cookieAttrs(res, TRUST_COOKIE);
    expect(cleared).toBeTruthy();
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('records the use, and says in the log that the code was skipped', async () => {
    const h = mountAuth();
    const made = await trust(h);
    expect(h.row<{ uses: number }>(`SELECT uses FROM trusted_devices`)?.uses).toBe(0);

    await signIn(h, `${TRUST_COOKIE}=${made.token}`);

    const after = h.row<{ uses: number; last_used_at: string | null }>(
      `SELECT uses, last_used_at FROM trusted_devices`)!;
    expect(after.uses).toBe(1);
    expect(after.last_used_at).toBeTruthy();

    const actions = h.rows<{ action: string }>(`SELECT action FROM audit_log`).map((r) => r.action);
    expect(actions).toContain('login.trusted_machine_used');
    expect(actions).toContain('login.success');
  });

  it('does not extend the deadline by being used — the 41st day is the 41st day', async () => {
    const h = mountAuth();
    const made = await trust(h);
    const before = h.row<{ expires_at: string }>(`SELECT expires_at FROM trusted_devices`)!.expires_at;
    await signIn(h, `${TRUST_COOKIE}=${made.token}`);
    await signIn(h, `${TRUST_COOKIE}=${made.token}`);
    expect(h.row<{ expires_at: string }>(`SELECT expires_at FROM trusted_devices`)!.expires_at)
      .toBe(before);
    expect(h.row<{ uses: number }>(`SELECT uses FROM trusted_devices`)!.uses).toBe(2);
  });

  it('does not lengthen the session it signs in to', async () => {
    const h = mountAuth();
    const made = await trust(h);
    await signIn(h, `${TRUST_COOKIE}=${made.token}`);
    const rec = h.row<{ created_at: string; expires_at: string }>(
      `SELECT created_at, expires_at FROM session_records`)!;
    const hours = (Date.parse(rec.expires_at) - Date.parse(rec.created_at)) / 3_600_000;
    expect(Math.round(hours)).toBe(12);
  });

  it('does not get past the per-account rate limiter', async () => {
    const h = mountAuth();
    const made = await trust(h);
    // Ten attempts in the window is the account's allowance.
    for (let i = 0; i < 10; i++) {
      await h.post('/login', { email: USER.email, password: 'wrong' }, `${TRUST_COOKIE}=${made.token}`);
    }
    const res = await signIn(h, `${TRUST_COOKIE}=${made.token}`);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Too many sign-in attempts');
    expect(h.count(`SELECT COUNT(*) AS n FROM session_records`)).toBe(0);
  });
});

// --- 3a. It is not a session, and only one place consults it -----------------

/** Every `.ts` under `src`, relative to it, apart from the module being asked about. */
function sourceFiles(dir = 'src', prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(`${dir}/${e.name}`, `${prefix}${e.name}/`)
      : (e.name.endsWith('.ts') ? [`${prefix}${e.name}`] : []));
}

/** Which files call something, by its call site rather than by a mention of its name. */
function callersOf(call: string): string[] {
  return sourceFiles()
    .filter((f) => f !== 'core/trusteddevices.ts')
    .filter((f) => readFileSync(`src/${f}`, 'utf8').includes(call))
    .sort();
}

describe('the cookie is a stand-in for the code and nothing more', () => {
  it('opens no page on its own — it is not a session', async () => {
    const h = mountAuth();
    const made = await trust(h);
    // The account pages are behind `requireAuth`, which reads a session cookie
    // this credential cannot produce. Nobody is signed in here.
    const res = await h.request('/account', {
      headers: { cookie: `${TRUST_COOKIE}=${made.token}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('is consulted by exactly one place in the whole register', () => {
    /*
     * Asserted against the source rather than a list somebody keeps up to date,
     * the way the upload token's single caller is. If a second route ever reads
     * a trusted machine — a middleware, say, deciding somebody is signed in —
     * this fails, and that is exactly the change that would turn a second-factor
     * stand-in into a session.
     */
    expect(callersOf('verifyTrustedDevice(')).toEqual(['modules/auth/index.ts']);
  });

  it('is never granted anywhere but the two-factor challenge', () => {
    expect(callersOf('createTrustedDevice(')).toEqual(['modules/auth/index.ts']);
  });
});

// --- 4. Trusting a machine at the challenge ----------------------------------

describe('the box on the two-factor page', () => {
  it('is a real form field, ticked, and says the number of days', async () => {
    const h = mountAuth();
    h.state.user = USER;
    h.state.session = unverifiedSession();
    const body = await (await h.request('/login/verify')).text();
    expect(body).toContain('name="remember"');
    expect(body).toContain('checked');
    expect(body).toContain(`Remember this machine for ${TRUSTED_DEVICE_DEFAULT_DAYS} days`);
    expect(body).toContain('shared or public computer');
  });

  it('is not offered at all when the practice has switched the feature off', async () => {
    const h = mountAuth();
    h.db.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('security.trusted_device_days','0','${AT}')`);
    h.state.user = USER;
    h.state.session = unverifiedSession();
    const body = await (await h.request('/login/verify')).text();
    expect(body).not.toContain('name="remember"');
  });

  it('trusts the machine when it is ticked, and sets a cookie that is not the secret in the clear', async () => {
    const h = mountAuth();
    h.state.user = USER;
    h.state.session = unverifiedSession();
    const res = await h.post('/login/verify', { code: await totpCode(TOTP_SECRET), remember: 'yes' });
    expect(res.status).toBe(303);

    const row = h.row<{ id: string; expires_at: string; created_at: string; user_agent: string | null }>(
      `SELECT id, expires_at, created_at, user_agent FROM trusted_devices`)!;
    const days = (Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86_400_000;
    expect(Math.round(days)).toBe(TRUSTED_DEVICE_DEFAULT_DAYS);
    expect(row.user_agent).toContain('A Browser');

    const cookie = cookieValue(res, TRUST_COOKIE)!;
    expect(cookie.startsWith('rt_')).toBe(true);
    const attrs = cookieAttrs(res, TRUST_COOKIE)!;
    expect(attrs).toContain('HttpOnly');
    expect(attrs).toContain('Secure');
    expect(attrs).toContain('SameSite=Lax');
    expect(attrs).toContain('Path=/');
    expect(attrs).toContain(`Max-Age=${TRUSTED_DEVICE_DEFAULT_DAYS * 86400}`);
    // And what it opens is the row that was just written.
    expect((await verifyTrustedDevice(h.env as any, cookie)).ok).toBe(true);
  });

  it('trusts nothing when the box is left unticked', async () => {
    const h = mountAuth();
    h.state.user = USER;
    h.state.session = unverifiedSession();
    const res = await h.post('/login/verify', { code: await totpCode(TOTP_SECRET) });
    expect(res.status).toBe(303);
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices`)).toBe(0);
    expect(cookieAttrs(res, TRUST_COOKIE)).toBeNull();
  });

  it('trusts nothing when the code was wrong', async () => {
    const h = mountAuth();
    h.state.user = USER;
    h.state.session = unverifiedSession();
    const res = await h.post('/login/verify', { code: '000000', remember: 'yes' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login/verify');
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices`)).toBe(0);
  });

  it('trusts nothing when the practice has switched the feature off, ticked or not', async () => {
    const h = mountAuth();
    h.db.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('security.trusted_device_days','0','${AT}')`);
    h.state.user = USER;
    h.state.session = unverifiedSession();
    await h.post('/login/verify', { code: await totpCode(TOTP_SECRET), remember: 'yes' });
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices`)).toBe(0);
  });

  it('writes an audit line when a machine is trusted', async () => {
    const h = mountAuth();
    h.state.user = USER;
    h.state.session = unverifiedSession();
    await h.post('/login/verify', { code: await totpCode(TOTP_SECRET), remember: 'yes' });
    const actions = h.rows<{ action: string }>(`SELECT action FROM audit_log`).map((r) => r.action);
    expect(actions).toContain('account.machine_trusted');
  });

  it('never writes the credential into the audit log', async () => {
    const h = mountAuth();
    h.state.user = USER;
    h.state.session = unverifiedSession();
    const res = await h.post('/login/verify', { code: await totpCode(TOTP_SECRET), remember: 'yes' });
    const cookie = cookieValue(res, TRUST_COOKIE)!;
    const secret = parseTrustToken(cookie)!.secret;
    const log = h.rows<{ meta_json: string | null }>(`SELECT meta_json FROM audit_log`)
      .map((r) => r.meta_json ?? '').join('\n');
    expect(log).not.toContain(secret);
    expect(log).not.toContain(TOTP_SECRET);
  });
});

// --- 5. It dies when the ground moves ----------------------------------------

describe('a trusted machine dies when the thing it stood for changes', () => {
  async function withTrust() {
    const h = mountAuth();
    const made = await trust(h);
    h.state.user = USER;
    h.state.session = { ...unverifiedSession(), verified: true };
    return { h, made };
  }

  const live = (h: Mounted) =>
    h.count(`SELECT COUNT(*) AS n FROM trusted_devices WHERE revoked_at IS NULL`);

  it('goes when the person changes their own password', async () => {
    const { h } = await withTrust();
    expect(live(h)).toBe(1);
    const res = await h.post('/account/password', {
      current_password: PASSWORD, new_password: 'another long password', confirm_password: 'another long password',
    });
    expect(res.status).toBe(303);
    expect(live(h)).toBe(0);
  });

  it('goes when two-factor is switched off', async () => {
    const { h } = await withTrust();
    const res = await h.post('/account/2fa/disable', { password: PASSWORD });
    expect(res.status).toBe(303);
    expect(live(h)).toBe(0);
  });

  it('goes when two-factor is switched on again', async () => {
    const { h } = await withTrust();
    // The enrolment flow holds the pending secret in KV against the session.
    const fresh = generateTotpSecret();
    await (h.env.SESSIONS as any).put(`totp-setup:${h.state.session!.sid}`, fresh);
    const res = await h.post('/account/2fa/enable', { code: await totpCode(fresh) });
    expect(res.status).toBe(200);
    expect(live(h)).toBe(0);
  });

  it('goes when a recovery code is used, and no new one is handed out in its place', async () => {
    const h = mountAuth();
    await trust(h);
    const code = 'rescue01';
    h.db.prepare(`UPDATE users SET recovery_code_hashes = ? WHERE id = ?`)
      .run(JSON.stringify([await sha256Hex(code)]), USER.id);
    h.state.user = USER;
    h.state.session = unverifiedSession();

    const res = await h.post('/login/verify', { code, remember: 'yes' });
    expect(res.status).toBe(303);
    expect(live(h)).toBe(0);
    // Nothing new, on the machine reporting the loss least of all.
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices`)).toBe(1);
    const actions = h.rows<{ action: string }>(`SELECT action FROM audit_log`).map((r) => r.action);
    expect(actions).toContain('account.machines_revoked');
    expect(actions).not.toContain('account.machine_trusted');
  });

  it('goes when an administrator suspends the account', async () => {
    const h = mountAuth();
    await trust(h);
    const admin = mountAdmin(h);
    const res = await admin.post('/admin/users/' + USER.id, {
      name: USER.name, email: USER.email, role: 'admin', status: 'suspended',
    });
    expect(res.status).toBe(303);
    expect(live(h)).toBe(0);
  });

  it('goes when an administrator resets the password', async () => {
    const h = mountAuth();
    await trust(h);
    const admin = mountAdmin(h);
    const res = await admin.post(`/admin/users/${USER.id}/reset-password`, {});
    expect(res.status).toBe(200);
    expect(live(h)).toBe(0);
  });

  /** The admin module over the same database, signed in as an owner. */
  function mountAdmin(h: Mounted) {
    const owner = fakeUser({ id: 'u_owner', email: 'owner@practice.test', role: 'owner' });
    const app = new Hono<AppContext>();
    app.use('*', async (c, next) => {
      c.set('user', owner);
      c.set('session', { ...unverifiedSession(), userId: owner.id, verified: true });
      c.set('requestId', 'req_test');
      c.set('nonce', 'nonce_test');
      await next();
    });
    adminModule.register(app);
    h.db.prepare(
      `INSERT OR IGNORE INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
       VALUES ('u_owner','owner@practice.test','AN OWNER','x','owner','active',?,?)`,
    ).run(AT, AT);
    return {
      post: (path: string, form: Record<string, string>) =>
        app.request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
          body: new URLSearchParams({ _csrf: 'test-csrf-token', ...form }),
        }, h.env as any),
    };
  }
});

// --- 6. Seeing and forgetting them -------------------------------------------

describe('the person can see their trusted machines and forget them', () => {
  async function signedIn() {
    const h = mountAuth();
    const made = await trust(h);
    h.state.user = USER;
    h.state.session = { ...unverifiedSession(), verified: true };
    return { h, made };
  }

  it('lists when it was trusted and when it expires, with a way to forget it', async () => {
    const { h, made } = await signedIn();
    const body = await (await h.request('/account?tab=sessions')).text();
    expect(body).toContain('Trusted machines');
    expect(body).toContain('/account/trusted-machines/revoke');
    expect(body).toContain(made.row.id);
  });

  it('does not print the credential on the page', async () => {
    const { h, made } = await signedIn();
    const body = await (await h.request('/account?tab=sessions')).text();
    expect(body).not.toContain(parseTrustToken(made.token)!.secret);
    expect(body).not.toContain(made.token);
  });

  it('forgets one, and the credential stops working at once', async () => {
    const { h, made } = await signedIn();
    const res = await h.post('/account/trusted-machines/revoke', { id: made.row.id });
    expect(res.status).toBe(303);
    expect((await verifyTrustedDevice(h.env as any, made.token)).ok).toBe(false);
    const actions = h.rows<{ action: string }>(`SELECT action FROM audit_log`).map((r) => r.action);
    expect(actions).toContain('account.machine_revoked');
  });

  it('cannot reach somebody else’s machine, and says the same thing as a machine that never existed', async () => {
    const { h } = await signedIn();
    h.db.prepare(
      `INSERT INTO users (id,email,name,password_hash,role,status,totp_enabled,totp_secret,created_at,updated_at)
       VALUES ('u_other','other@practice.test','SOMEBODY ELSE','x','admin','active',1,?,?,?)`,
    ).run(TOTP_SECRET, AT, AT);
    const theirs = await createTrustedDevice(h.env as any, {
      userId: 'u_other', totpSecret: TOTP_SECRET, days: 40,
    });

    const mine = await h.post('/account/trusted-machines/revoke', { id: theirs.row.id });
    const invented = await h.post('/account/trusted-machines/revoke', { id: 'trd_never_existed' });
    expect(mine.headers.get('location')).toBe(invented.headers.get('location'));
    // Theirs is untouched and still works.
    expect(h.row<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM trusted_devices WHERE id = ?`, theirs.row.id)?.revoked_at).toBeNull();
    expect((await verifyTrustedDevice(h.env as any, theirs.token)).ok).toBe(true);
  });

  it('forgets every one of them in a single press', async () => {
    const { h } = await signedIn();
    await trust(h);
    await trust(h);
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices WHERE revoked_at IS NULL`)).toBe(3);
    const res = await h.post('/account/trusted-machines/revoke', { id: 'all' });
    expect(res.status).toBe(303);
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices WHERE revoked_at IS NULL`)).toBe(0);
  });

  it('scopes "forget everything" to the person who pressed it', async () => {
    const { h } = await signedIn();
    h.db.prepare(
      `INSERT INTO users (id,email,name,password_hash,role,status,totp_enabled,totp_secret,created_at,updated_at)
       VALUES ('u_other','other@practice.test','SOMEBODY ELSE','x','admin','active',1,?,?,?)`,
    ).run(TOTP_SECRET, AT, AT);
    const theirs = await createTrustedDevice(h.env as any, {
      userId: 'u_other', totpSecret: TOTP_SECRET, days: 40,
    });
    await h.post('/account/trusted-machines/revoke', { id: 'all' });
    expect(h.row<{ revoked_at: string | null }>(
      `SELECT revoked_at FROM trusted_devices WHERE id = ?`, theirs.row.id)?.revoked_at).toBeNull();
  });

  it('lists only your own', async () => {
    const { h } = await signedIn();
    h.db.prepare(
      `INSERT INTO users (id,email,name,password_hash,role,status,totp_enabled,totp_secret,created_at,updated_at)
       VALUES ('u_other','other@practice.test','SOMEBODY ELSE','x','admin','active',1,?,?,?)`,
    ).run(TOTP_SECRET, AT, AT);
    const theirs = await createTrustedDevice(h.env as any, {
      userId: 'u_other', totpSecret: TOTP_SECRET, days: 40,
    });
    const mine = await trustedDevicesFor(h.env as any, USER.id);
    expect(mine.map((m) => m.id)).not.toContain(theirs.row.id);
    const body = await (await h.request('/account?tab=sessions')).text();
    expect(body).not.toContain(theirs.row.id);
  });
});

// --- 7. The setting, and the ceiling an administrator cannot raise -----------

describe('how long a machine stays trusted is a setting with a ceiling in code', () => {
  it('is forty days when nobody has said otherwise', async () => {
    const h = mountAuth();
    expect(await trustedDeviceDays(h.env as any)).toBe(TRUSTED_DEVICE_DEFAULT_DAYS);
  });

  it('is whatever an administrator set, when that is under the ceiling', async () => {
    const h = mountAuth();
    h.db.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('security.trusted_device_days','7','${AT}')`);
    expect(await trustedDeviceDays(h.env as any)).toBe(7);
  });

  it('is the ceiling when somebody writes ten years into the database by hand', async () => {
    const h = mountAuth();
    h.db.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('security.trusted_device_days','3650','${AT}')`);
    expect(await trustedDeviceDays(h.env as any)).toBe(TRUSTED_DEVICE_MAX_DAYS);
  });

  it('is off for 0, and off for anything that is not a number of days', async () => {
    for (const value of ['0', '-5', 'forever', '40.5', '']) {
      const h = mountAuth();
      h.db.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('security.trusted_device_days','${value}','${AT}')`);
      expect(await trustedDeviceDays(h.env as any), value).toBe(0);
    }
  });

  it('refuses to grant more than the ceiling even when asked directly', async () => {
    const h = mountAuth();
    const made = await createTrustedDevice(h.env as any, {
      userId: USER.id, totpSecret: TOTP_SECRET, days: 3650,
    });
    const days = (Date.parse(made.row.expires_at) - Date.parse(made.row.created_at)) / 86_400_000;
    expect(Math.round(days)).toBe(TRUSTED_DEVICE_MAX_DAYS);
  });

  /**
   * **The row is exactly as long as it says, to the millisecond.**
   *
   * This was written after a deploy went red. `createTrustedDevice` read the
   * clock twice — once for `created_at` and again for `expires_at` — so a row
   * asked for at the ceiling came out a few milliseconds *over* ninety days
   * and the database refused it. Whether it failed depended on whether the
   * clock ticked between two statements, so it passed on the pull request and
   * failed on `main` minutes later.
   *
   * `Math.round` was what hid it: the old assertion above rounded the length
   * to the nearest day, which is true of 90 days and of 90 days plus an hour.
   * So the rule is pinned exactly here — not rounded — because "exactly" is
   * what the ceiling compares against.
   */
  it('makes a row exactly as many days long as it was asked for', async () => {
    for (const days of [1, 40, TRUSTED_DEVICE_MAX_DAYS]) {
      const h = mountAuth();
      const made = await createTrustedDevice(h.env as any, {
        userId: USER.id, totpSecret: TOTP_SECRET, days,
      });
      const ms = Date.parse(made.row.expires_at) - Date.parse(made.row.created_at);
      expect(ms, `${days} days`).toBe(days * 86_400_000);
    }
  });

  it('grants the ceiling every time, not only when the clock is kind', async () => {
    // The original fault was intermittent, so once proves little. Twenty
    // consecutive grants at exactly the ceiling: any drift between the two
    // ends of the row puts one of them over and the database aborts.
    const h = mountAuth();
    for (let i = 0; i < 20; i++) {
      const made = await createTrustedDevice(h.env as any, {
        userId: USER.id, totpSecret: TOTP_SECRET, days: TRUSTED_DEVICE_MAX_DAYS,
      });
      expect(Date.parse(made.row.expires_at) - Date.parse(made.row.created_at))
        .toBe(TRUSTED_DEVICE_MAX_DAYS * 86_400_000);
    }
  });
});

// --- 8. The revocation helpers themselves ------------------------------------

describe('the revocation helpers are scoped and countable', () => {
  it('counts what it forgot and leaves already-forgotten rows alone', async () => {
    const h = mountAuth();
    const a = await trust(h);
    await trust(h);
    expect(await revokeTrustedDevice(h.env as any, { userId: USER.id, id: a.row.id })).toBe(true);
    expect(await revokeTrustedDevice(h.env as any, { userId: USER.id, id: a.row.id })).toBe(false);
    expect(await revokeAllTrustedDevices(h.env as any, USER.id)).toBe(1);
    expect(await revokeAllTrustedDevices(h.env as any, USER.id)).toBe(0);
  });
});
