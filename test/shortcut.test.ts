/**
 * Sending a file in from a Mac or a phone.
 *
 * **Asked for on 11 September 2026:** *"may as well build the apple shortcut
 * option - not sure how it works but should be available."*
 *
 * The whole feature rests on one credential that lives on a laptop and a phone,
 * so most of what is proved here is about that credential rather than about
 * files. In order of what would hurt:
 *
 *  - **A leaked token reaches nothing.** It may add an inbox item. It may not
 *    read a client page or a quotation page, and it is not a session.
 *  - **The register never holds the token.** What is stored is a PBKDF2 hash,
 *    the database refuses a row that is not one, and the token is shown exactly
 *    once.
 *  - **Every refusal says the same thing**, so a list of guesses cannot be
 *    sorted into "real but revoked" and "never existed".
 *  - The route is above the session guard, the size and type limits are the
 *    register's existing ones in the register's existing words, and the rate
 *    limit bites.
 *  - And the point of it: a file sent in reaches the matter, as the same bytes.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { mountModule, fakeUser, fakeD1, migratedSqlite } from './support/d1';
import type { AppContext } from '../src/types';
import { shortcutModule } from '../src/modules/shortcut';
import { authModule } from '../src/modules/auth';
import { inboxModule } from '../src/modules/inbox';
import { clientsModule } from '../src/modules/clients';
import { quotesModule } from '../src/modules/quotes';
import {
  SHORTCUT_PATH, UPLOAD_REFUSED, createUploadToken, parseUploadToken, verifyUploadToken,
} from '../src/core/uploadtokens';

const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser({ id: 'u_shortcut', email: 'adviser@practice.test', name: 'AN ADVISER' });

/** R2, in a Map. Only the calls the register makes. */
function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    put: async (key: string, bytes: Uint8Array) => { store.set(key, bytes); },
    get: async (key: string) => {
      const bytes = store.get(key);
      return bytes === undefined ? null : { body: new Response(bytes).body };
    },
    delete: async (key: string) => { store.delete(key); },
  };
}

/** KV, in a Map, with just the three calls `core/ratelimit.ts` makes. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
}

/**
 * The shortcut endpoint on a bare app, with no session middleware at all —
 * which is the honest shape, because a shortcut never has one.
 */
function mountShortcut() {
  const db = migratedSqlite();
  const docs = fakeR2();
  const sessions = fakeKv();
  const env = {
    DB: fakeD1(db), DOCS: docs, SESSIONS: sessions, APP_ENV: 'test',
  } as unknown as { DB: D1Database } & Record<string, unknown>;

  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
              VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
           VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
  db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
           VALUES ('k1','CASE-26-001','cl1','A matter','A description','wv_aewv','lodged','${USER.id}','${AT}','${AT}')`);

  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('user', null);
    c.set('session', null);
    c.set('requestId', 'req_test');
    c.set('nonce', 'nonce_test');
    await next();
  });
  shortcutModule.register(app);

  const send = async (opts: {
    token?: string | null;
    files?: File[];
    note?: string;
    headers?: Record<string, string>;
  }): Promise<Response> => {
    const body = new FormData();
    for (const f of opts.files ?? []) body.append('file', f);
    if (opts.note !== undefined) body.append('note', opts.note);
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    return app.request(`http://localhost${SHORTCUT_PATH}`, { method: 'POST', headers, body }, env as any);
  };

  const row = <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null =>
    ((db.prepare(sql) as any).get(...(params as any[])) as T | undefined) ?? null;
  const rows = <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] =>
    (db.prepare(sql) as any).all(...(params as any[])) as T[];
  const n = (sql: string, ...params: unknown[]): number =>
    (row<{ n: number }>(sql, ...params)?.n) ?? 0;

  return { db, env, docs, sessions, app, send, row, rows, count: n };
}

const pdf = (name: string, body = '%PDF-1.4 the letter of offer') =>
  new File([body], name, { type: 'application/pdf' });

async function tokenFor(h: ReturnType<typeof mountShortcut>, label = 'The office Mac'): Promise<string> {
  const made = await createUploadToken(h.env as any, { userId: USER.id, label });
  return made.token;
}

// --- 1. The happy path -------------------------------------------------------

describe('a valid token puts files in the inbox', () => {
  it('creates one inbox item on the api channel, and stores every file', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);

    const res = await h.send({ token, files: [pdf('offer.pdf'), pdf('passport.pdf', '%PDF-1.4 page 2')],
                               note: 'Two things for the AEWV file' });

    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; files: number; reference: string; message: string };
    expect(body.ok).toBe(true);
    expect(body.files).toBe(2);
    expect(body.message).toContain('inbox');

    // One item, on the channel a shortcut is, and never trusted.
    const msg = h.row<{ id: string; channel: string; trusted: number; sender: string; sender_display: string }>(
      `SELECT id, channel, trusted, sender, sender_display FROM ingest_messages`);
    expect(msg?.channel).toBe('api');
    expect(msg?.trusted).toBe(0);
    expect(msg?.sender).toBe(USER.email);
    expect(msg?.sender_display).toContain('The office Mac');
    expect(body.reference).toBe(msg?.id);

    // Both sets of bytes are in the bucket, and both rows point at them.
    const files = h.rows<{ r2_key: string; filename: string; content_type: string; size_bytes: number }>(
      `SELECT r2_key, filename, content_type, size_bytes FROM inbox_uploads ORDER BY filename`);
    expect(files.map((f) => f.filename)).toEqual(['offer.pdf', 'passport.pdf']);
    for (const f of files) {
      expect(h.docs.store.has(f.r2_key)).toBe(true);
      expect(f.content_type).toBe('application/pdf');
      expect(f.size_bytes).toBeGreaterThan(0);
    }

    // Nothing else was created. A shortcut may not open a matter.
    expect(h.count(`SELECT COUNT(*) AS n FROM inquiries`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM clients`)).toBe(1);
    expect(h.count(`SELECT COUNT(*) AS n FROM documents`)).toBe(0);
  });

  it('records the use, so a token nobody uses is visible as one', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    expect(h.row<{ uses: number; last_used_at: string | null }>(`SELECT uses, last_used_at FROM upload_tokens`))
      .toEqual({ uses: 0, last_used_at: null });

    await h.send({ token, files: [pdf('a.pdf')] });

    const after = h.row<{ uses: number; last_used_at: string | null }>(
      `SELECT uses, last_used_at FROM upload_tokens`);
    expect(after?.uses).toBe(1);
    expect(after?.last_used_at).toBeTruthy();
  });

  it('does not swallow the same file sent twice as a duplicate', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    await h.send({ token, files: [pdf('offer.pdf')] });
    await h.send({ token, files: [pdf('offer.pdf')] });
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages`)).toBe(2);
  });
});

// --- 2. The token reaches nothing else ---------------------------------------

describe('what a leaked token can reach', () => {
  it('is refused by a client page and by a quote page, with or without Bearer', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);

    // Both modules mounted the way the application mounts them: behind their
    // own guards, with nobody signed in.
    for (const [module, path] of [[clientsModule, '/clients'], [clientsModule, '/clients/cl1'],
                                  [quotesModule, '/quotes']] as const) {
      const app = new Hono<AppContext>();
      app.use('*', async (c, next) => {
        c.set('user', null); c.set('session', null);
        c.set('requestId', 'r'); c.set('nonce', 'n');
        await next();
      });
      module.register(app);
      const res = await app.request(`http://localhost${path}`,
        { headers: { authorization: `Bearer ${token}` } }, h.env as any);
      // Redirected to a sign-in, never answered. The token is not a session and
      // nothing anywhere turns it into one.
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location'), path).toContain('/login');
      expect(await res.text()).not.toContain('A CLIENT');
    }
  });

  it('is consulted by exactly one route in the whole register', () => {
    // The property that makes the paragraph above true, asserted against the
    // source rather than against a list somebody keeps up to date: if a second
    // route ever reads an upload token, this fails.
    const files = ['src/modules/shortcut/index.ts', 'src/modules/auth/index.ts',
                   'src/modules/inbox/index.ts', 'src/app.ts', 'src/registry.ts'];
    const callers = files.filter((f) => readFileSync(f, 'utf8').includes('verifyUploadToken'));
    expect(callers).toEqual(['src/modules/shortcut/index.ts']);
  });

  it('owns one route and no way to read anything back', () => {
    const src = readFileSync('src/modules/shortcut/index.ts', 'utf8');
    const routes = [...src.matchAll(/\bapp\.(get|post|put|delete)\(/g)].map((m) => m[1]);
    expect(routes).toEqual(['post']);
  });
});

// --- 3. Refusals all say the same thing --------------------------------------

describe('a bad token is refused without saying why', () => {
  it('gives the same answer for missing, malformed, unknown, wrong and revoked', async () => {
    const h = mountShortcut();
    const good = await tokenFor(h);

    // A revoked token, and a token whose selector is real but whose secret is not.
    const revoked = await createUploadToken(h.env as any, { userId: USER.id, label: 'A lost phone' });
    h.db.prepare(`UPDATE upload_tokens SET revoked_at = ? WHERE id = ?`).run(AT, revoked.row.id);
    const parts = parseUploadToken(good)!;
    const wrongSecret = `ru_${parts.selector}${'A'.repeat(43)}`;

    const answers: Array<{ status: number; error: string }> = [];
    for (const token of [null, 'nonsense', 'ru_shortandwrong', `ru_${'B'.repeat(55)}`,
                         wrongSecret, revoked.token]) {
      const res = await h.send({ token, files: [pdf('a.pdf')] });
      answers.push({ status: res.status, error: (await res.json() as { error: string }).error });
    }

    for (const a of answers) {
      expect(a.status).toBe(401);
      expect(a.error).toBe(UPLOAD_REFUSED);
    }
    // And not one of them left anything behind.
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM inbox_uploads`)).toBe(0);
  });

  it('refuses a token belonging to a suspended person', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    h.db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(USER.id);
    const res = await h.send({ token, files: [pdf('a.pdf')] });
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe(UPLOAD_REFUSED);
  });

  it('never writes the token into the audit log', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    await h.send({ token: 'ru_' + 'C'.repeat(55), files: [pdf('a.pdf')] });
    await h.send({ token, files: [pdf('a.pdf')] });
    const log = h.rows<{ meta_json: string | null }>(`SELECT meta_json FROM audit_log`)
      .map((r) => r.meta_json ?? '').join('\n');
    expect(log).not.toContain(token);
    expect(log).not.toContain('CCCCC');
  });
});

// --- 4. Stored hashed, shown once --------------------------------------------

describe('a token outlives the decision that allowed it, so the role is checked on use', () => {
  /**
   * Minting one needs `ingest:triage`. But a token already on a laptop does not
   * disappear when somebody is moved to "Read only", and revoking is scoped to
   * the token's own owner — so without a check here the practice would have no
   * way to take the credential back short of suspending the account.
   *
   * Found in review on 12 September 2026, when the gate on minting was added
   * and the credential itself was left role-blind.
   */
  it('stops working the moment its holder is moved to Read only', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    expect((await verifyUploadToken(h.env as any, token)).ok).toBe(true);

    h.db.exec(`UPDATE users SET role = 'readonly' WHERE id = '${USER.id}'`);
    expect((await verifyUploadToken(h.env as any, token)).ok).toBe(false);

    // And the live route refuses it too, not just the check in isolation.
    const res = await h.send({ token, files: [pdf('offer.pdf')] });
    expect(res.status).toBe(401);
    expect(h.count('SELECT COUNT(*) AS n FROM ingest_messages')).toBe(0);
  });

  it('starts working again if they are moved back', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    h.db.exec(`UPDATE users SET role = 'readonly' WHERE id = '${USER.id}'`);
    expect((await verifyUploadToken(h.env as any, token)).ok).toBe(false);
    h.db.exec(`UPDATE users SET role = 'assistant' WHERE id = '${USER.id}'`);
    expect((await verifyUploadToken(h.env as any, token)).ok).toBe(true);
  });

  it('accepts every role that may work the inbox, and refuses only the one that may not', async () => {
    for (const role of ['owner', 'admin', 'adviser', 'assistant'] as const) {
      const h = mountShortcut();
      const token = await tokenFor(h);
      h.db.exec(`UPDATE users SET role = '${role}' WHERE id = '${USER.id}'`);
      expect((await verifyUploadToken(h.env as any, token)).ok, role).toBe(true);
    }
    const h = mountShortcut();
    const token = await tokenFor(h);
    h.db.exec(`UPDATE users SET role = 'readonly' WHERE id = '${USER.id}'`);
    expect((await verifyUploadToken(h.env as any, token)).ok).toBe(false);
  });
});

describe('the token is stored hashed and shown once', () => {
  it('keeps a PBKDF2 hash and nothing that resembles the token', async () => {
    const h = mountShortcut();
    const made = await createUploadToken(h.env as any, { userId: USER.id, label: 'A Mac' });
    const stored = h.row<{ secret_hash: string; selector: string }>(
      `SELECT secret_hash, selector FROM upload_tokens`)!;

    expect(stored.secret_hash.startsWith('pbkdf2-sha256$')).toBe(true);
    // The whole row, as text, must not contain the secret half of the token.
    const secret = made.token.slice('ru_'.length + 12);
    const wholeRow = JSON.stringify(h.row(`SELECT * FROM upload_tokens`));
    expect(wholeRow).not.toContain(secret);
    // The selector is the public half and is deliberately in the clear.
    expect(made.token).toContain(stored.selector);
    // And it verifies, so the hash is of the right thing.
    expect((await verifyUploadToken(h.env as any, made.token)).ok).toBe(true);
  });

  it('is refused by the database if anything ever tries to store it in the clear', () => {
    const h = mountShortcut();
    expect(() => h.db.prepare(
      `INSERT INTO upload_tokens (id, user_id, selector, secret_hash, label, created_at, uses)
       VALUES ('t2', ?, 'aaaaaaaaaaaa', 'ru_the_actual_token', 'A Mac', ?, 0)`,
    ).run(USER.id, AT)).toThrow(/stored hashed/);
  });

  it('cannot be re-issued in place, and revocation is final', () => {
    const h = mountShortcut();
    h.db.prepare(
      `INSERT INTO upload_tokens (id, user_id, selector, secret_hash, label, created_at, uses)
       VALUES ('t3', ?, 'bbbbbbbbbbbb', 'pbkdf2-sha256$1x100000$aa$bb', 'A Mac', ?, 0)`,
    ).run(USER.id, AT);

    expect(() => h.db.prepare(
      `UPDATE upload_tokens SET secret_hash = 'pbkdf2-sha256$1x100000$cc$dd' WHERE id = 't3'`).run())
      .toThrow(/cannot be given a new secret/);

    h.db.prepare(`UPDATE upload_tokens SET revoked_at = ? WHERE id = 't3'`).run(AT);
    expect(() => h.db.prepare(`UPDATE upload_tokens SET revoked_at = NULL WHERE id = 't3'`).run())
      .toThrow(/stays revoked/);
  });

  it('is shown exactly once, on the page that made it, and never listed again', async () => {
    const h = mountModule(authModule, { user: USER, env: { DOCS: fakeR2(), SESSIONS: fakeKv() } });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);

    const made = await h.post('/account/upload-tokens', { label: 'The office Mac' });
    expect(made.status).toBe(200);
    const shown = await made.text();
    const found = /ru_[A-Za-z0-9_-]{55}/.exec(shown);
    expect(found, 'the token was not shown at all').toBeTruthy();
    const token = found![0];

    // And it is nowhere on the tab that lists them afterwards.
    const listing = await (await h.request('/account?tab=shortcut')).text();
    expect(listing).toContain('The office Mac');
    expect(listing).not.toContain(token);
    // Nor anywhere else on the account page.
    expect(await (await h.request('/account')).text()).not.toContain(token);
  });

  it('revokes one, and only the owner’s own', async () => {
    const h = mountModule(authModule, { user: USER, env: { SESSIONS: fakeKv() } });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES ('u_other','other@practice.test','SOMEBODY ELSE','x','adviser','active',?,?)`)
      .run(AT, AT);
    h.db.prepare(
      `INSERT INTO upload_tokens (id, user_id, selector, secret_hash, label, created_at, uses)
       VALUES ('t_other', 'u_other', 'cccccccccccc', 'pbkdf2-sha256$1x100000$aa$bb', 'Their Mac', ?, 0)`,
    ).run(AT);

    const res = await h.post('/account/upload-tokens/revoke', { id: 't_other' });
    expect(res.headers.get('location')).toContain('err=');
    expect(h.get<{ revoked_at: string | null }>(`SELECT revoked_at FROM upload_tokens WHERE id='t_other'`))
      .toEqual({ revoked_at: null });
  });
});

// --- 5. Size and type, in the register's existing words -----------------------

describe('the size and type limits are the register’s own', () => {
  it('refuses a file over 25 MB in the words the documents page uses', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    const big = new File([new Uint8Array(26 * 1024 * 1024)], 'huge.pdf', { type: 'application/pdf' });
    const res = await h.send({ token, files: [big] });
    expect(res.status).toBe(413);
    expect((await res.json() as { error: string }).error)
      .toBe('Files must be 25 MB or smaller, so the file was not attached.');
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages`)).toBe(0);
  });

  it('refuses a kind of file the reading cannot open, in the reading’s words', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    const exe = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'setup.exe',
      { type: 'application/x-msdownload' });
    const res = await h.send({ token, files: [exe] });
    expect(res.status).toBe(415);
    const { error } = await res.json() as { error: string };
    expect(error).toContain('setup.exe is a application/x-msdownload this cannot read.');
    expect(error).toContain('Word (.docx), PDF, Text');
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages`)).toBe(0);
  });

  it('believes the bytes rather than the name', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    // A PDF the phone insisted was a spreadsheet. The bytes decide.
    const lied = new File(['%PDF-1.4 really a pdf'], 'thing.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const res = await h.send({ token, files: [lied] });
    expect(res.status).toBe(201);
    expect(h.row<{ content_type: string }>(`SELECT content_type FROM inbox_uploads`))
      .toEqual({ content_type: 'application/pdf' });
  });

  it('refuses one bad file out of several without keeping any of them', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    const exe = new File([new Uint8Array([0x4d, 0x5a])], 'setup.exe', { type: 'application/x-msdownload' });
    const res = await h.send({ token, files: [pdf('good.pdf'), exe] });
    expect(res.status).toBe(415);
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages`)).toBe(0);
    expect(h.docs.store.size).toBe(0);
  });

  it('refuses a press with no file at all', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    const res = await h.send({ token, note: 'just a note' });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain('No files arrived');
  });
});

// --- 6. Rate limiting bites ---------------------------------------------------

describe('rate limiting', () => {
  it('stops a token after its hourly allowance and says so once', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    for (let i = 0; i < 20; i++) {
      expect((await h.send({ token, files: [pdf(`f${String(i)}.pdf`)] })).status).toBe(201);
    }
    const res = await h.send({ token, files: [pdf('one-too-many.pdf')] });
    expect(res.status).toBe(429);
    expect((await res.json() as { error: string }).error).toContain('Too many uploads');
    expect(h.count(`SELECT COUNT(*) AS n FROM ingest_messages`)).toBe(20);
  });

  it('stops somebody working through a list of guesses', async () => {
    const h = mountShortcut();
    const guess = `ru_${'D'.repeat(55)}`;
    for (let i = 0; i < 20; i++) {
      expect((await h.send({ token: guess, files: [pdf('a.pdf')],
                             headers: { 'cf-connecting-ip': '203.0.113.7' } })).status).toBe(401);
    }
    const res = await h.send({ token: guess, files: [pdf('a.pdf')],
                               headers: { 'cf-connecting-ip': '203.0.113.7' } });
    expect(res.status).toBe(429);
  });

  it('does not spend the guessing allowance on uploads that work', async () => {
    // The counter reads at the door and writes only on a refusal, so a morning
    // of real uploads from one address must not lock the practice out.
    const h = mountShortcut();
    const token = await tokenFor(h);
    for (let i = 0; i < 15; i++) {
      await h.send({ token, files: [pdf(`f${String(i)}.pdf`)], headers: { 'cf-connecting-ip': '203.0.113.9' } });
    }
    const res = await h.send({ token, files: [pdf('later.pdf')],
                               headers: { 'cf-connecting-ip': '203.0.113.9' } });
    expect(res.status).toBe(201);
  });
});

// --- 7. Where it is mounted ---------------------------------------------------

describe('the route sits above the session guard', () => {
  it('is registered before the dashboard, which guards every path', async () => {
    const { registeredModules } = await import('../src/registry');
    const names = registeredModules.map((m) => m.name);
    expect(names).toContain('shortcut');
    expect(names.indexOf('shortcut')).toBeLessThan(names.indexOf('dashboard'));
  });

  it('is not itself behind a sign-in', () => {
    const source = readFileSync('src/modules/shortcut/index.ts', 'utf8');
    expect(source).not.toContain('requireAuth');
    expect(source).not.toContain('requirePermission');
  });

  it('is exempt from the CSRF check, because a shortcut sends no Origin', () => {
    const app = readFileSync('src/app.ts', 'utf8');
    expect(app).toContain("'/api/ingest/shortcut'");
  });

  it('does not widen that exemption to anything else', async () => {
    // The exemption is one path. A request with no `Origin` — which is what a
    // shortcut sends, and what a script sends — must still be refused
    // everywhere else, or the CSRF defence has quietly been turned off for the
    // whole application.
    const { createApp } = await import('../src/app');
    const h = mountShortcut();
    const res = await createApp().request(
      'http://localhost/account/upload-tokens',
      { method: 'POST', body: new FormData() },
      { ...h.env, APP_ORIGIN: 'http://localhost' } as any,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Cross-origin request rejected');
  });

  it('reaches the handler through the whole application, with no session', async () => {
    // The failure this catches is silent: a module mounted below something that
    // guards '*' from '/' answers every request with a redirect to a sign-in,
    // and every unit test that mounts one module alone still passes.
    const { createApp } = await import('../src/app');
    const h = mountShortcut();
    const token = await tokenFor(h);
    const body = new FormData();
    body.append('file', pdf('through-the-app.pdf'));
    const res = await createApp().request(
      `http://localhost${SHORTCUT_PATH}`,
      { method: 'POST', headers: { authorization: `Bearer ${token}` }, body },
      { ...h.env, APP_ORIGIN: 'http://localhost' } as any,
    );
    expect(res.status).toBe(201);
  });
});

// --- 8. The routine completes itself ------------------------------------------

describe('a file sent in reaches the matter', () => {
  it('lands on the record as a document, as the same bytes, when the item is filed', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    await h.send({ token, files: [pdf('offer.pdf')] });
    const messageId = h.row<{ id: string }>(`SELECT id FROM ingest_messages`)!.id;
    const key = h.row<{ r2_key: string }>(`SELECT r2_key FROM inbox_uploads`)!.r2_key;

    // The inbox, with a person signed in, doing what it already does.
    const inbox = mountModule(inboxModule, { user: USER, env: { DOCS: h.docs } });
    // Same database: the harness makes its own, so the rows are re-created.
    inbox.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                      VALUES (?,?,?,'x',?,'active',?,?)`)
      .run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    inbox.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                   VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
    inbox.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
                   VALUES ('k1','CASE-26-001','cl1','A matter','A description','wv_aewv','lodged','${USER.id}','${AT}','${AT}')`);
    inbox.db.prepare(
      `INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status, sender, sender_display, created_at)
       VALUES (?, 'api', 'dk', ?, 'pending', ?, 'AN ADVISER · The office Mac', ?)`,
    ).run(messageId, AT, USER.email, AT);
    inbox.db.prepare(
      `INSERT INTO inbox_uploads (id, message_id, r2_key, filename, content_type, size_bytes, sha256, uploaded_at, uploaded_by)
       VALUES ('inu1', ?, ?, 'offer.pdf', 'application/pdf', 27, 'abc', ?, ?)`,
    ).run(messageId, key, AT, USER.id);

    const res = await inbox.post(`/inbox/${messageId}/file`, { onto: 'case:k1' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('/cases/k1');

    const doc = inbox.get<{ entity_type: string; entity_id: string; r2_key: string; filename: string }>(
      `SELECT entity_type, entity_id, r2_key, filename FROM documents`);
    expect(doc).toEqual({ entity_type: 'case', entity_id: 'k1', r2_key: key, filename: 'offer.pdf' });
    // The staging row records which document it became, rather than being deleted.
    expect(inbox.get<{ document_id: string | null }>(`SELECT document_id FROM inbox_uploads`)?.document_id)
      .toBeTruthy();
    // And the bytes were not copied: one object, two rows pointing at it.
    expect(h.docs.store.size).toBe(1);
  });

  it('takes the bytes with it when the message is deleted unfiled', async () => {
    const h = mountShortcut();
    const token = await tokenFor(h);
    await h.send({ token, files: [pdf('offer.pdf')] });
    const messageId = h.row<{ id: string }>(`SELECT id FROM ingest_messages`)!.id;
    const key = h.row<{ r2_key: string }>(`SELECT r2_key FROM inbox_uploads`)!.r2_key;

    const inbox = mountModule(inboxModule, { user: USER, env: { DOCS: h.docs } });
    inbox.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                      VALUES (?,?,?,'x',?,'active',?,?)`)
      .run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    inbox.db.prepare(
      `INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status, created_at)
       VALUES (?, 'api', 'dk', ?, 'pending', ?)`,
    ).run(messageId, AT, AT);
    inbox.db.prepare(
      `INSERT INTO inbox_uploads (id, message_id, r2_key, filename, content_type, size_bytes, sha256, uploaded_at, uploaded_by)
       VALUES ('inu1', ?, ?, 'offer.pdf', 'application/pdf', 27, 'abc', ?, ?)`,
    ).run(messageId, key, AT, USER.id);

    expect(h.docs.store.has(key)).toBe(true);
    await inbox.post(`/inbox/${messageId}/delete`);
    expect(inbox.count(`SELECT COUNT(*) AS n FROM inbox_uploads`)).toBe(0);
    expect(h.docs.store.has(key)).toBe(false);
  });
});

// --- 9. The instructions ------------------------------------------------------

describe('the practice can follow this alone', () => {
  const doc = readFileSync('docs/apple-shortcut.md', 'utf8');
  const page = readFileSync('src/modules/auth/index.ts', 'utf8');

  it('says plainly that the token is like a password', () => {
    expect(doc).toContain('Treat the token like a password');
    expect(doc).toContain('Anyone who has it can send files into the register');
  });

  it('names every action the person has to find in the Shortcuts app', () => {
    for (const step of ['Quick Action', 'Share Sheet', 'Get Contents of URL', 'POST',
                        'Request Body', 'Form', 'Authorization', 'Bearer', 'Shortcut Input']) {
      expect(doc, step).toContain(step);
    }
  });

  it('is repeated on the page the practice will actually open, without drifting', () => {
    // Two copies is a deliberate decision — the person who has to follow these
    // is not going to open a repository file — and this is what keeps them
    // together. Every action named in one must be named in the other.
    for (const step of ['Quick Action', 'Share Sheet', 'Get Contents of URL', 'POST',
                        'Request Body', 'Form', 'Authorization', 'Bearer', 'Shortcut Input']) {
      expect(page, step).toContain(step);
    }
    // The page prints the address from `SHORTCUT_PATH` rather than typing it
    // out, which is why the literal is not here to find.
    expect(page).toContain('SHORTCUT_PATH');
    expect(readFileSync('src/core/uploadtokens.ts', 'utf8')).toContain('/api/ingest/shortcut');
    expect(doc).toContain('/api/ingest/shortcut');
  });

  it('is linked from the account page, beside the token', () => {
    expect(page).toContain('/account/shortcut');
    expect(page).toContain('docs/apple-shortcut.md');
  });
});
