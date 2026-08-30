/**
 * The doors that stand between a signed-in request and the practice's most
 * sensitive data: passport sealing on its write path, role-based access to
 * PII pages and exports, and the sessions that decide who is signed in at all.
 *
 * Run as a gate before any real passport or date of birth is loaded. The
 * cryptography itself (round-trip, wrong key, tampering, bad key length) is
 * pinned in `test/crypto.test.ts`; this suite covers the paths a request
 * takes to and from it, and the session machinery, over the real routes and
 * a database built from the migrations.
 *
 * All data invented; real client data never enters this repository.
 */

import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { fakeD1, fakeUser, migratedSqlite, mountModule } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { adminModule } from '../src/modules/admin';
import { addPassport } from '../src/core/passports';
import { unsealField } from '../src/core/crypto';
import { requireAuth } from '../src/core/auth';
import { createSession, destroySessionBySid, readSession, revokeAllSessions } from '../src/core/session';
import type { AppContext, SessionData } from '../src/types';

const at = '2026-08-29T00:00:00Z';
// 32 bytes, base64 — the shape FIELD_KEY has in production. Invented, obviously.
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');

function seed(db: any) {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u_test', 'tester@example.test', 'A Tester', 'x', 'admin', ?, ?)`)
    .run(at, at);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('cl_1', 'CL-1', 'individual', 'Invented PERSON', 'active', ?, ?)`)
    .run(at, at);
}

describe('recording a passport number fails closed when it cannot be sealed', () => {
  it('the core refuses rather than silently dropping the number', async () => {
    const h = mountModule(clientsModule); // no FIELD_KEY in env
    seed(h.db);
    await expect(addPassport(h.env as any, {
      clientId: 'cl_1', country: 'NZ', number: 'FAKE12345', issuedOn: null, expiresOn: null,
      status: 'held', isPrimary: false, notes: null, userId: 'u_test',
    })).rejects.toThrow(/FIELD_KEY is not configured/);
    // And nothing was written — not a row with a blank where the number was.
    expect(h.count(`SELECT COUNT(*) AS n FROM client_passports`)).toBe(0);
  });

  it('the add-passport route says what is wrong instead of saving half a record', async () => {
    const h = mountModule(clientsModule);
    seed(h.db);
    const res = await h.post('/clients/cl_1/passports', { country: 'NZ', number: 'FAKE12345' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('FIELD_KEY');
    expect(h.count(`SELECT COUNT(*) AS n FROM client_passports`)).toBe(0);
  });

  it('a passport without a number is still recordable — only the number needs the key', async () => {
    const h = mountModule(clientsModule);
    seed(h.db);
    const res = await h.post('/clients/cl_1/passports', { country: 'NZ', expires_on: '2030-01-01' });
    expect(res.status).toBe(303);
    expect(h.count(`SELECT COUNT(*) AS n FROM client_passports`)).toBe(1);
  });
});

describe('a sealed number leaves the database only through the reveal', () => {
  async function withPassport() {
    const h = mountModule(clientsModule, { env: { FIELD_KEY: KEY } });
    seed(h.db);
    const res = await h.post('/clients/cl_1/passports', { country: 'NZ', number: 'FAKE12345' });
    expect(res.status).toBe(303);
    return h;
  }

  it('what is stored is ciphertext, not the number', async () => {
    const h = await withPassport();
    const row = h.get<{ number_sealed: string }>(`SELECT number_sealed FROM client_passports`)!;
    expect(row.number_sealed).toMatch(/^v1\./);
    expect(row.number_sealed).not.toContain('FAKE12345');
    expect(await unsealField(row.number_sealed, KEY)).toBe('FAKE12345');
  });

  it('the reveal returns the number and goes down in the audit log', async () => {
    const h = await withPassport();
    const pid = h.get<{ id: string }>(`SELECT id FROM client_passports`)!.id;
    const res = await h.post(`/clients/cl_1/passports/${pid}/reveal`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('FAKE12345');
    expect(h.count(
      `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'client.passport_revealed'`)).toBe(1);
  });

  it('a suspended account is refused, whatever its role says', async () => {
    const h = mountModule(clientsModule, {
      env: { FIELD_KEY: KEY }, user: fakeUser({ role: 'admin', status: 'suspended' }),
    });
    seed(h.db);
    const res = await h.post('/clients/cl_1/passports/pas_x/reveal');
    expect(res.status).toBe(403);
  });
});

describe('PII does not leave through the export', () => {
  it('only admin:settings can reach it at all', async () => {
    for (const role of ['readonly', 'assistant', 'adviser'] as const) {
      const h = mountModule(adminModule, { user: fakeUser({ role }) });
      expect((await h.request('/admin/export')).status, role).toBe(403);
      expect((await h.request('/admin/export/clients.csv')).status, role).toBe(403);
      expect((await h.request('/admin/export/passports.csv')).status, role).toBe(403);
    }
  });

  it('and what it hands over carries no passport number, sealed or plain', async () => {
    const h = mountModule(adminModule, { env: { FIELD_KEY: KEY } });
    seed(h.db);
    await addPassport(h.env as any, {
      clientId: 'cl_1', country: 'NZ', number: 'FAKE12345', issuedOn: null,
      expiresOn: '2030-01-01', status: 'held', isPrimary: true, notes: null, userId: 'u_test',
    });
    for (const key of ['clients', 'passports']) {
      const res = await h.request(`/admin/export/${key}.csv`);
      expect(res.status, key).toBe(200);
      const csv = await res.text();
      expect(csv, key).not.toContain('FAKE12345');
      expect(csv, key).not.toContain('v1.');
    }
  });
});

describe('sessions deny when they should', () => {
  function sessionEnv() {
    const db = migratedSqlite();
    const store = new Map<string, string>();
    const SESSIONS = {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    };
    const env = { DB: fakeD1(db), SESSIONS } as any;
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
                VALUES ('u_test', 'tester@example.test', 'A Tester', 'x', 'admin', ?, ?)`)
      .run(at, at);
    return { env, db, store };
  }

  const req = new Request('http://localhost/');

  it('a live session reads back; a revoked one is gone and stays recorded as revoked', async () => {
    const { env, db } = sessionEnv();
    const token = await createSession(env, fakeUser(), req, { verified: true });
    const live = await readSession(env, token);
    expect(live?.verified).toBe(true);

    await destroySessionBySid(env, live!.sid);
    expect(await readSession(env, token)).toBeNull();
    const rec = (db.prepare(`SELECT revoked_at FROM session_records WHERE id = ?`) as any).get(live!.sid);
    expect(rec.revoked_at).not.toBeNull();
  });

  it('an expired session denies, however recently it was used', async () => {
    const { env, store } = sessionEnv();
    const token = await createSession(env, fakeUser(), req, { verified: true });
    const [k, raw] = [...store.entries()][0]!;
    store.set(k, JSON.stringify({ ...JSON.parse(raw), expiresAt: Date.now() - 1, lastSeenAt: Date.now() }));
    expect(await readSession(env, token)).toBeNull();
  });

  it('an idle session denies, however far off its hard expiry is', async () => {
    const { env, store } = sessionEnv();
    const token = await createSession(env, fakeUser(), req, { verified: true });
    const [k, raw] = [...store.entries()][0]!;
    store.set(k, JSON.stringify({
      ...JSON.parse(raw), lastSeenAt: Date.now() - (4 * 60 * 60 * 1000 + 1000) }));
    expect(await readSession(env, token)).toBeNull();
  });

  it('revoking everything signs out every session, not just the newest', async () => {
    const { env } = sessionEnv();
    const t1 = await createSession(env, fakeUser(), req, { verified: true });
    const t2 = await createSession(env, fakeUser(), req, { verified: true });
    const n = await revokeAllSessions(env, 'u_test');
    expect(n).toBe(2);
    expect(await readSession(env, t1)).toBeNull();
    expect(await readSession(env, t2)).toBeNull();
  });

  it('a token nobody issued opens nothing', async () => {
    const { env } = sessionEnv();
    await createSession(env, fakeUser(), req, { verified: true });
    expect(await readSession(env, 'A'.repeat(43))).toBeNull();
  });
});

describe('an unverified session cannot pass the door', () => {
  function appWith(session: Partial<SessionData> | null) {
    const app = new Hono<AppContext>();
    app.use('*', async (c, next) => {
      c.set('user', session ? fakeUser() : null);
      c.set('session', session as SessionData | null);
      await next();
    });
    app.use('*', requireAuth);
    app.get('/secret', (c) => c.text('the goods'));
    return app;
  }

  const base: SessionData = {
    sid: 's', userId: 'u_test', csrf: 'x',
    createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, verified: true,
  };

  it('password-only (TOTP pending) is sent to the challenge, not the page', async () => {
    const res = await appWith({ ...base, verified: false }).request('http://localhost/secret');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login/verify');
  });

  it('no session at all is sent to sign in', async () => {
    const res = await appWith(null).request('http://localhost/secret');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/login?next=');
  });

  it('a verified session passes', async () => {
    const res = await appWith(base).request('http://localhost/secret');
    expect(res.status).toBe(200);
  });
});
