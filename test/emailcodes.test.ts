/**
 * The six-digit code sent by email, as a fallback at the two-factor challenge.
 *
 * **Asked for on 12 September 2026:** *"build the email code as a fallback"*,
 * after being told that of the three ways of doing this a text message is the
 * weakest and the only one that costs money.
 *
 * It is a credential, so what is proved here is the same list the upload token
 * and the trusted machine are held to — fault 43, *a bearer credential outlives
 * the decision that allowed it, so the permission is checked where it is spent*:
 *
 *  - **It is a fallback, not a second way to have weak two-factor.** No code is
 *    sent to an account that does not already have two-factor switched on.
 *  - **It goes to the address on the account and nowhere else**, whatever is
 *    posted.
 *  - **It is never stored as it was sent.** A hash, and the database refuses a
 *    row that is not one.
 *  - **Ten minutes and one use**, both of which the database keeps as well as
 *    the route.
 *  - **Asking is limited and trying is limited.** A six-digit code with
 *    unlimited attempts is a four-hour brute force.
 *  - **It is not offered at all when the register cannot send email**, because
 *    the queue would hold the message and the button would appear to work.
 *  - **It does not disturb the trusted machine**, which stays pinned to the
 *    authenticator's secret.
 *
 * The database's own refusals are attacked directly, with SQL, rather than
 * through the application — the rule in CLAUDE.md.
 *
 * All data invented; real client data never enters this repository.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { fakeD1, fakeUser, migratedSqlite } from './support/d1';
import type { AppContext, SessionData, User } from '../src/types';
import { authModule } from '../src/modules/auth';
import {
  EMAIL_CODE_MINUTES, createLoginEmailCode, emailCodeOffer, loginEmailCodeMessage,
  randomDigits, verifyLoginEmailCode,
} from '../src/core/emailcodes';
import { TRUST_COOKIE, createTrustedDevice } from '../src/core/trusteddevices';
import { generateTotpSecret, hashPassword, sha256Hex, totpCode } from '../src/core/crypto';

const AT = '2026-09-12T09:00:00Z';
const PASSWORD = 'a long enough password';
/** Hashed once: PBKDF2 is deliberately slow, and every test wants the same account. */
const PASSWORD_HASH = await hashPassword(PASSWORD);
const TOTP_SECRET = generateTotpSecret();

const USER: User = fakeUser({
  id: 'u_code', email: 'adviser@practice.test', name: 'AN ADVISER', role: 'admin', totp_enabled: 1,
});

/** What the provider was handed, so "to whom" can be asserted at the far end. */
let sent: Array<{ to: string[]; subject: string; text: string }> = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { to: string[]; subject: string; text: string };
    sent.push(body);
    return new Response(JSON.stringify({ id: 're_test' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

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
 * The auth module on a bare app, with whoever is signed in held in `state`.
 *
 * `mail: false` is the register with no provider configured — the state every
 * register is in until somebody sets `MAIL_PROVIDER`, and the one where the
 * link must not be offered at all.
 */
function mountAuth(opts: { totpEnabled?: boolean; status?: string; mail?: boolean } = {}): Mounted {
  const db = migratedSqlite();
  const kv = fakeKv();
  const env = {
    DB: fakeD1(db), SESSIONS: kv, APP_ENV: 'test', APP_NAME: 'Register',
    ...(opts.mail === false ? {} : {
      MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'key_test', MAIL_FROM: 'register@practice.test',
    }),
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

/** An unverified session — the state a correct password leaves behind. */
function unverifiedSession(): SessionData {
  return {
    sid: 's_code', userId: USER.id, csrf: 'test-csrf-token',
    createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, verified: false,
  };
}

/** At the challenge, having given the right password. */
function atChallenge(h: Mounted): Mounted {
  h.state.user = USER;
  h.state.session = unverifiedSession();
  return h;
}

/** Ask for a code the way the page asks, and read the one that was emailed. */
async function askForCode(h: Mounted): Promise<string> {
  await h.post('/login/email-code', { next: '/' });
  const body = sent[sent.length - 1]?.text ?? '';
  const found = /\b(\d{6})\b/.exec(body);
  expect(found, 'no six-digit code in the email that was sent').not.toBeNull();
  return found![1]!;
}

function auditActions(h: Mounted): string[] {
  return h.rows<{ action: string }>(`SELECT action FROM audit_log`).map((r) => r.action);
}

// --- 1. What the database refuses, attacked with SQL --------------------------

describe('the database keeps the rules, not the route that happens to write the row', () => {
  const HASH = 'pbkdf2-sha256$1x100000$AAAA$BBBB';

  function schema() {
    const db = migratedSqlite();
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','active','${AT}','${AT}')`);
    return db;
  }

  const insert = (db: any, over: Record<string, unknown> = {}) => {
    const r: Record<string, any> = {
      id: 'lec1', user_id: 'u1', code_hash: HASH,
      created_at: '2026-09-12T00:00:00Z', expires_at: '2026-09-12T00:10:00Z', ...over,
    };
    db.prepare(
      `INSERT INTO login_email_codes (id,user_id,code_hash,created_at,expires_at)
       VALUES (?,?,?,?,?)`,
    ).run(r.id, r.user_id, r.code_hash, r.created_at, r.expires_at);
  };

  it('refuses a row whose code is not a hash', () => {
    const db = schema();
    expect(() => insert(db, { code_hash: '481920' })).toThrow(/stored hashed/);
  });

  it('refuses an update that puts a code back in the clear', () => {
    const db = schema();
    insert(db);
    // Two refusals cover this and either may answer first — SQLite does not
    // promise an order. `cannot be changed in place` gets there in practice;
    // `stored hashed` is the one that holds if the other is ever dropped. What
    // matters is that the row cannot come to hold a working code.
    expect(() => db.exec(`UPDATE login_email_codes SET code_hash = '481920' WHERE id='lec1'`))
      .toThrow(/stored hashed|cannot be changed in place/);
    expect((db.prepare(`SELECT code_hash FROM login_email_codes`) as any).get().code_hash).toBe(HASH);
  });

  it('refuses a row with no deadline at all', () => {
    const db = schema();
    expect(() => db.prepare(
      `INSERT INTO login_email_codes (id,user_id,code_hash,created_at,expires_at)
       VALUES ('lec','u1',?,?,NULL)`,
    ).run(HASH, AT)).toThrow(/NOT NULL/);
  });

  it('refuses a deadline that is not after the moment it was made', () => {
    const db = schema();
    expect(() => insert(db, { expires_at: '2026-09-11T00:00:00Z' })).toThrow(/CHECK/);
  });

  it('refuses more than ten minutes, and allows exactly ten', () => {
    const db = schema();
    expect(() => insert(db, { expires_at: '2026-09-12T00:11:00Z' }))
      .toThrow(/lasts ten minutes/);
    insert(db, { id: 'lec_ok', expires_at: '2026-09-12T00:10:00Z' });
    expect((db.prepare(`SELECT COUNT(*) n FROM login_email_codes`) as any).get().n).toBe(1);
  });

  it('refuses to move the deadline', () => {
    const db = schema();
    insert(db);
    expect(() => db.exec(`UPDATE login_email_codes SET expires_at = '2026-09-13T00:00:00Z' WHERE id='lec1'`))
      .toThrow(/was always going to expire/);
  });

  it('refuses to touch a code that has been used — single use, at the database', () => {
    const db = schema();
    insert(db);
    db.exec(`UPDATE login_email_codes SET used_at = '${AT}' WHERE id='lec1'`);
    expect(() => db.exec(`UPDATE login_email_codes SET used_at = NULL WHERE id='lec1'`))
      .toThrow(/has been used is finished/);
    expect(() => db.exec(`UPDATE login_email_codes SET ip = '10.0.0.1' WHERE id='lec1'`))
      .toThrow(/has been used is finished/);
  });

  it('refuses to write a new code over a live one', () => {
    const db = schema();
    insert(db);
    expect(() => db.exec(
      `UPDATE login_email_codes SET code_hash = 'pbkdf2-sha256$1x100000$CCCC$DDDD' WHERE id='lec1'`))
      .toThrow(/cannot be changed in place/);
  });

  it('refuses to move a code to another person', () => {
    const db = schema();
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u2','c@d.test','B','x','owner','active','${AT}','${AT}')`);
    insert(db);
    expect(() => db.exec(`UPDATE login_email_codes SET user_id = 'u2' WHERE id='lec1'`))
      .toThrow(/belongs to the person it was sent to/);
  });

  it('refuses a second live code for the same person', () => {
    const db = schema();
    insert(db);
    expect(() => insert(db, { id: 'lec2' })).toThrow(/UNIQUE/);
  });

  it('takes a person’s code with them when the account goes', () => {
    const db = schema();
    insert(db);
    db.exec(`DELETE FROM users WHERE id = 'u1'`);
    expect((db.prepare(`SELECT COUNT(*) n FROM login_email_codes`) as any).get().n).toBe(0);
  });
});

// --- 2. The code itself -------------------------------------------------------

describe('the code', () => {
  it('is six digits, and does not come off a predictable ladder', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = randomDigits();
      expect(code).toMatch(/^\d{6}$/);
      seen.add(code);
    }
    // 200 draws from a million: a repeat is possible, a handful is not.
    expect(seen.size).toBeGreaterThan(195);
  });

  it('keeps leading zeros rather than handing out a five-digit code', () => {
    // `(value % range).toString()` alone would turn 42 into "42".
    expect(randomDigits(6)).toHaveLength(6);
    expect(randomDigits(4)).toHaveLength(4);
  });

  it('says the three things the letter has to say, and carries no link', () => {
    const { subject, text } = loginEmailCodeMessage('481920', 'Register');
    /*
     * The code is in the body and **not** in the subject, which is where every
     * other service puts it. The queue writes `mail.sent` into the audit log
     * with the recipient and the subject, and the audit log cannot be edited or
     * deleted by anybody — so a code in the subject is a live credential
     * written permanently into the one table that keeps everything. Found by
     * this test on 12 September 2026, having been written the other way first.
     */
    expect(subject).not.toContain('481920');
    expect(text).toContain('481920');
    expect(text).toContain(`${EMAIL_CODE_MINUTES} minutes`);
    expect(text).toMatch(/did not just try to sign in/);
    // A sign-in email with a link in it is the shape every phishing message has.
    expect(text).not.toMatch(/https?:\/\//);
  });
});

// --- 3. Judged at the moment it is spent (fault 43) --------------------------

describe('every condition is read fresh when the code is presented', () => {
  it('accepts a live code, once, and marks it spent', async () => {
    const h = mountAuth();
    const made = await createLoginEmailCode(h.env as any, { userId: USER.id });
    expect((await verifyLoginEmailCode(h.env as any, USER.id, made.code)).ok).toBe(true);
    expect(h.row<{ used_at: string | null }>(`SELECT used_at FROM login_email_codes`)?.used_at)
      .toBeTruthy();
    // And a second time is nothing at all.
    expect((await verifyLoginEmailCode(h.env as any, USER.id, made.code)).ok).toBe(false);
  });

  it('refuses one whose ten minutes have passed', async () => {
    const h = mountAuth();
    // Planted rather than made: the database refuses to move a deadline, which
    // is the point, so an expired row has to be born expired.
    const code = '481920';
    h.db.prepare(
      `INSERT INTO login_email_codes (id,user_id,code_hash,created_at,expires_at)
       VALUES ('lec_old',?,?,?,?)`,
    ).run(USER.id, await hashPassword(code),
      new Date(Date.now() - 20 * 60_000).toISOString(),
      new Date(Date.now() - 10 * 60_000).toISOString());

    expect((await verifyLoginEmailCode(h.env as any, USER.id, code)).ok).toBe(false);
    // And it is left unspent: refusing is not using.
    expect(h.row<{ used_at: string | null }>(`SELECT used_at FROM login_email_codes`)?.used_at)
      .toBeNull();
  });

  it('accepts one with a minute left', async () => {
    const h = mountAuth();
    const code = '112233';
    h.db.prepare(
      `INSERT INTO login_email_codes (id,user_id,code_hash,created_at,expires_at)
       VALUES ('lec_soon',?,?,?,?)`,
    ).run(USER.id, await hashPassword(code),
      new Date(Date.now() - 9 * 60_000).toISOString(),
      new Date(Date.now() + 60_000).toISOString());
    expect((await verifyLoginEmailCode(h.env as any, USER.id, code)).ok).toBe(true);
  });

  it('refuses one belonging to a suspended person', async () => {
    const h = mountAuth();
    const made = await createLoginEmailCode(h.env as any, { userId: USER.id });
    h.db.exec(`UPDATE users SET status = 'suspended' WHERE id = '${USER.id}'`);
    expect((await verifyLoginEmailCode(h.env as any, USER.id, made.code)).ok).toBe(false);
  });

  it('refuses one after two-factor has been switched off under it', async () => {
    const h = mountAuth();
    const made = await createLoginEmailCode(h.env as any, { userId: USER.id });
    h.db.exec(`UPDATE users SET totp_enabled = 0 WHERE id = '${USER.id}'`);
    expect((await verifyLoginEmailCode(h.env as any, USER.id, made.code)).ok).toBe(false);
  });

  it('refuses a wrong code, nonsense, and nothing at all', async () => {
    const h = mountAuth();
    const made = await createLoginEmailCode(h.env as any, { userId: USER.id });
    const wrong = made.code === '000000' ? '111111' : '000000';
    for (const presented of [wrong, 'not a code', '', '48192', '4819201']) {
      expect((await verifyLoginEmailCode(h.env as any, USER.id, presented)).ok, presented).toBe(false);
    }
    // None of that spent it: the real one still works afterwards.
    expect((await verifyLoginEmailCode(h.env as any, USER.id, made.code)).ok).toBe(true);
  });

  it('refuses a code belonging to somebody else', async () => {
    const h = mountAuth();
    h.db.prepare(
      `INSERT INTO users (id,email,name,password_hash,role,status,totp_enabled,totp_secret,created_at,updated_at)
       VALUES ('u_other','other@practice.test','SOMEBODY ELSE',?,'admin','active',1,?,?,?)`,
    ).run(PASSWORD_HASH, TOTP_SECRET, AT, AT);
    const theirs = await createLoginEmailCode(h.env as any, { userId: 'u_other' });
    expect((await verifyLoginEmailCode(h.env as any, USER.id, theirs.code)).ok).toBe(false);
  });

  it('never holds the code — what is stored is a hash, and only a hash', async () => {
    const h = mountAuth();
    const made = await createLoginEmailCode(h.env as any, { userId: USER.id });
    const stored = h.row<Record<string, unknown>>(`SELECT * FROM login_email_codes`)!;
    expect(String(stored.code_hash).startsWith('pbkdf2-sha256$')).toBe(true);
    // No column is the code, and no column can be matched against it.
    for (const [column, value] of Object.entries(stored)) {
      expect(String(value ?? ''), column).not.toBe(made.code);
    }
    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes WHERE code_hash = ?`, made.code)).toBe(0);
  });
});

// --- 4. Only offered where it should be --------------------------------------

describe('whether a code may be sent at all', () => {
  it('is offered to somebody with two-factor on, on a register that can send', async () => {
    const h = mountAuth();
    const offer = await emailCodeOffer(h.env as any, USER.id);
    expect(offer.ok).toBe(true);
    expect(offer.ok && offer.email).toBe(USER.email);
  });

  it('is not offered when the register has no email provider', async () => {
    const h = mountAuth({ mail: false });
    const offer = await emailCodeOffer(h.env as any, USER.id);
    expect(offer.ok).toBe(false);
    expect(!offer.ok && offer.reason).toBe('no_provider');
  });

  it('is not offered to an account without two-factor — this is not a way to have weak two-factor', async () => {
    const h = mountAuth({ totpEnabled: false });
    const offer = await emailCodeOffer(h.env as any, USER.id);
    expect(offer.ok).toBe(false);
    expect(!offer.ok && offer.reason).toBe('no_two_factor');
  });

  it('is not offered to a suspended person', async () => {
    const h = mountAuth({ status: 'suspended' });
    const offer = await emailCodeOffer(h.env as any, USER.id);
    expect(offer.ok).toBe(false);
    expect(!offer.ok && offer.reason).toBe('not_active');
  });
});

// --- 5. The link on the challenge page ---------------------------------------

describe('the link under the code box', () => {
  it('is there, and says where the code goes and how long it lasts', async () => {
    const h = atChallenge(mountAuth());
    const body = await (await h.request('/login/verify')).text();
    expect(body).toContain('/login/email-code');
    expect(body).toContain('Send a code to my email instead');
    expect(body).toContain('the address on your account');
    expect(body).toContain(`${EMAIL_CODE_MINUTES} minutes`);
  });

  it('is not drawn at all when the register cannot send, and says why', async () => {
    const h = atChallenge(mountAuth({ mail: false }));
    const body = await (await h.request('/login/verify')).text();
    expect(body).not.toContain('Send a code to my email instead');
    expect(body).not.toContain('action="/login/email-code"');
    // Said rather than silently missing: somebody looking for the option needs
    // to know it is not coming.
    expect(body).toContain('A code cannot be emailed to you');
  });

  it('carries the page somebody was going to, so the code does not lose their place', async () => {
    const h = atChallenge(mountAuth());
    const body = await (await h.request('/login/verify?next=%2Fclients')).text();
    expect(body).toMatch(/action="\/login\/email-code"[\s\S]{0,200}value="\/clients"/);
  });
});

// --- 6. Asking for one -------------------------------------------------------

describe('asking for a code', () => {
  it('writes one row, and emails it to the address on the account', async () => {
    const h = atChallenge(mountAuth());
    const res = await h.post('/login/email-code', { next: '/' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/login/verify');

    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes`)).toBe(1);
    const mail = h.row<{ to_addr: string; subject: string; body_text: string; status: string }>(
      `SELECT to_addr, subject, body_text, status FROM outbound_emails`)!;
    expect(mail.to_addr).toBe(USER.email);
    expect(mail.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([USER.email]);
  });

  it('goes to the account’s address whatever the form says', async () => {
    // There is no address box on the page. This is the other half of that: a
    // field posted by hand changes nothing, because nothing reads one.
    const h = atChallenge(mountAuth());
    await h.post('/login/email-code', { next: '/', email: 'somebody@elsewhere.test', to: 'somebody@elsewhere.test' });
    expect(sent[0]!.to).toEqual([USER.email]);
    expect(h.row<{ to_addr: string }>(`SELECT to_addr FROM outbound_emails`)?.to_addr).toBe(USER.email);
  });

  it('sends nothing at all when the register has no provider', async () => {
    const h = atChallenge(mountAuth({ mail: false }));
    const res = await h.post('/login/email-code', { next: '/' });
    expect(res.status).toBe(303);
    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM outbound_emails`)).toBe(0);
    expect(sent).toHaveLength(0);
    expect(auditActions(h)).toContain('login.email_code_refused');
  });

  it('sends nothing to an account without two-factor', async () => {
    const h = atChallenge(mountAuth({ totpEnabled: false }));
    await h.post('/login/email-code', { next: '/' });
    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM outbound_emails`)).toBe(0);
  });

  it('sends nothing to somebody who is not at the challenge at all', async () => {
    const h = mountAuth();
    const res = await h.post('/login/email-code', { next: '/' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes`)).toBe(0);
  });

  it('replaces the code before it — one live code per person, and the old one dies', async () => {
    const h = atChallenge(mountAuth());
    const first = await askForCode(h);
    const second = await askForCode(h);
    expect(second).not.toBe(first);
    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes`)).toBe(1);
    expect((await verifyLoginEmailCode(h.env as any, USER.id, first)).ok).toBe(false);
    expect((await verifyLoginEmailCode(h.env as any, USER.id, second)).ok).toBe(true);
  });

  it('is limited to three in a quarter of an hour', async () => {
    const h = atChallenge(mountAuth());
    for (let i = 0; i < 3; i++) await h.post('/login/email-code', { next: '/' });
    expect(sent).toHaveLength(3);

    const res = await h.post('/login/email-code', { next: '/' });
    expect(res.headers.get('location')).toContain('err=');
    // Nothing was sent, and the code that was already out is untouched.
    expect(sent).toHaveLength(3);
    expect(h.count(`SELECT COUNT(*) AS n FROM outbound_emails`)).toBe(3);
    expect(auditActions(h)).toContain('login.email_code_rate_limited');
  });

  it('writes a line in the log, and never the code itself', async () => {
    const h = atChallenge(mountAuth());
    const code = await askForCode(h);
    expect(auditActions(h)).toContain('login.email_code_sent');
    // Every column of it, not only the meta: the queue's own `mail.sent` line
    // carries the subject, which is why the code is not in the subject.
    const log = JSON.stringify(h.rows(`SELECT * FROM audit_log`));
    expect(log).not.toContain(code);
  });
});

// --- 7. Using one at the challenge -------------------------------------------

describe('signing in with a code that came by email', () => {
  it('passes the challenge, and says in the log which way in was used', async () => {
    const h = atChallenge(mountAuth());
    const code = await askForCode(h);

    const res = await h.post('/login/verify', { code, next: '/' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).not.toContain('/login/verify');
    expect(h.state.session!.verified).toBe(true);

    const actions = auditActions(h);
    expect(actions).toContain('login.email_code_used');
    expect(actions).toContain('login.success');
    const success = h.rows<{ action: string; meta_json: string | null }>(
      `SELECT action, meta_json FROM audit_log WHERE action = 'login.success'`)[0]!;
    expect(success.meta_json).toContain('email_code');
  });

  it('works once — the same code a second time is refused', async () => {
    const h = atChallenge(mountAuth());
    const code = await askForCode(h);
    await h.post('/login/verify', { code, next: '/' });

    const h2 = atChallenge(h);
    h2.state.session = unverifiedSession();
    const res = await h2.post('/login/verify', { code, next: '/' });
    expect(res.headers.get('location')).toContain('/login/verify');
    expect(h.state.session!.verified).toBe(false);
  });

  it('is refused once the ten minutes are up', async () => {
    const h = atChallenge(mountAuth());
    const code = '481920';
    h.db.prepare(
      `INSERT INTO login_email_codes (id,user_id,code_hash,created_at,expires_at)
       VALUES ('lec_old',?,?,?,?)`,
    ).run(USER.id, await hashPassword(code),
      new Date(Date.now() - 20 * 60_000).toISOString(),
      new Date(Date.now() - 10 * 60_000).toISOString());

    const res = await h.post('/login/verify', { code, next: '/' });
    expect(res.headers.get('location')).toContain('/login/verify');
    expect(h.state.session!.verified).toBe(false);
  });

  it('counts a wrong guess at a live code as its own thing in the log', async () => {
    const h = atChallenge(mountAuth());
    const code = await askForCode(h);
    const wrong = code === '000000' ? '111111' : '000000';
    await h.post('/login/verify', { code: wrong, next: '/' });
    const actions = auditActions(h);
    expect(actions).toContain('login.email_code_failed');
    expect(actions).toContain('login.totp_failed');
    expect(h.state.session!.verified).toBe(false);
  });

  it('does not get past the limit on trying — ten attempts is the allowance', async () => {
    const h = atChallenge(mountAuth());
    const code = await askForCode(h);
    for (let i = 0; i < 10; i++) await h.post('/login/verify', { code: '000000', next: '/' });

    const res = await h.post('/login/verify', { code, next: '/' });
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toContain('Too many attempts');
    expect(h.state.session!.verified).toBe(false);
    // And the code is still unspent, so the limiter refused rather than the code.
    expect(h.row<{ used_at: string | null }>(`SELECT used_at FROM login_email_codes`)?.used_at)
      .toBeNull();
  });

  it('leaves the authenticator the ordinary way in, and finishes off any code in an inbox', async () => {
    const h = atChallenge(mountAuth());
    await askForCode(h);
    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes`)).toBe(1);

    const res = await h.post('/login/verify', { code: await totpCode(TOTP_SECRET), next: '/' });
    expect(res.status).toBe(303);
    expect(h.state.session!.verified).toBe(true);
    expect(h.count(`SELECT COUNT(*) AS n FROM login_email_codes`)).toBe(0);
  });
});

// --- 8. What it does not disturb ---------------------------------------------

describe('the trusted machine is untouched by any of this', () => {
  it('can still be trusted after coming in by email code, and is pinned to the authenticator', async () => {
    const h = atChallenge(mountAuth());
    const code = await askForCode(h);
    await h.post('/login/verify', { code, next: '/', remember: 'yes' });

    const row = h.row<{ totp_fingerprint: string }>(`SELECT totp_fingerprint FROM trusted_devices`);
    expect(row).not.toBeNull();
    // The fingerprint is of the TOTP secret, not of anything to do with the
    // email code — so turning two-factor off and on again still kills it.
    expect(row!.totp_fingerprint).toBe(await sha256Hex(TOTP_SECRET));
  });

  it('does not forget machines the way a recovery code does', async () => {
    // A recovery code means the authenticator is gone. An email code means the
    // phone is in the other room, which is not the same event.
    const h = mountAuth();
    await createTrustedDevice(h.env as any, { userId: USER.id, totpSecret: TOTP_SECRET, days: 40 });
    atChallenge(h);
    const code = await askForCode(h);
    await h.post('/login/verify', { code, next: '/' });
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices WHERE revoked_at IS NULL`)).toBe(1);
  });

  it('does not make a machine trusted by itself', async () => {
    const h = atChallenge(mountAuth());
    const code = await askForCode(h);
    const res = await h.post('/login/verify', { code, next: '/' });
    expect(h.count(`SELECT COUNT(*) AS n FROM trusted_devices`)).toBe(0);
    expect(res.headers.get('set-cookie') ?? '').not.toContain(TRUST_COOKIE);
  });
});

// --- 9. Only one place in the register consults it ---------------------------

/** Every `.ts` under `src`, relative to it, apart from the file being asked about. */
function sourceFiles(dir = 'src', prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(`${dir}/${e.name}`, `${prefix}${e.name}/`)
      : (e.name.endsWith('.ts') ? [`${prefix}${e.name}`] : []));
}

function callersOf(call: string): string[] {
  return sourceFiles()
    .filter((f) => f !== 'core/emailcodes.ts')
    .filter((f) => readFileSync(`src/${f}`, 'utf8').includes(call))
    .sort();
}

describe('the code is a way through the challenge and nothing else', () => {
  it('is consulted by exactly one place in the whole register', () => {
    expect(callersOf('verifyLoginEmailCode(')).toEqual(['modules/auth/index.ts']);
  });

  it('is issued from exactly one place', () => {
    expect(callersOf('createLoginEmailCode(')).toEqual(['modules/auth/index.ts']);
  });

  it('has nowhere to type a different address', () => {
    // The rule is that it goes to the address on the account. The way to be
    // sure is that no page offers a box, rather than that no page is meant to.
    const auth = readFileSync('src/modules/auth/index.ts', 'utf8');
    const block = auth.slice(auth.indexOf("r.post('/login/email-code'"));
    expect(block.slice(0, 3000)).not.toMatch(/f\.(email|text|optional)\('(email|address|to)'/);
  });
});
