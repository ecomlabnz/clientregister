import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dormantClients, stillDormant } from '../src/core/dormant';
import { mountModule, fakeUser, type Harness } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import type { User } from '../src/types';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * Clients the practice has finished with.
 *
 * A person whose matters are all closed and whose documents have all expired
 * goes on raising alerts for ever. The practice said so: *"some of the visa
 * expiries we cannot handle — as the clients move on."*
 *
 * The register already had the answer and had never used it — an archived
 * client raises no expiry alert anywhere. What was missing was finding them.
 * These tests are about where the line is drawn, because the cost of drawing it
 * loosely is a live client disappearing off the alerts page.
 */

const AT = '2026-09-03T00:00:00Z';
const TODAY = '2026-09-03';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner',?,?)`).run(AT, AT);

  const client = (id: string, ref: string, visa: string | null, status = 'active') =>
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, current_visa_expiry,
                                     created_at, updated_at)
                VALUES (?, ?, 'individual', ?, ?, ?, ?, ?)`)
      .run(id, ref, `Person ${ref}`, status, visa, AT, AT);
  const matter = (id: string, clientId: string, status: string, closed: string | null = null) =>
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   closed_at, created_at, updated_at)
                VALUES (?, ?, ?, 'A matter', 'wv_aewv', ?, 'u1', ?, ?, ?)`)
      .run(id, `CASE-26-${id}`, clientId, status, closed, AT, AT);
  const passport = (id: string, clientId: string, expires: string, status = 'held') =>
    db.prepare(`INSERT INTO client_passports (id, client_id, country, number, expires_on,
                                              status, is_primary, created_at)
                VALUES (?, ?, 'NZ', ?, ?, ?, 0, ?)`)
      .run(id, clientId, `P${id}`, expires, status, AT);
  const cert = (id: string, clientId: string, expires: string) =>
    db.prepare(`INSERT INTO client_certificates (id, client_id, kind, expires_on, created_at)
                VALUES (?, ?, 'police', ?, ?)`).run(id, clientId, expires, AT);
  return { db, client, matter, passport, cert };
}

const envFor = (db: ReturnType<typeof register>['db']) => ({
  DB: {
    prepare(sql: string) {
      return { bind: (...p: unknown[]) => ({ all: async () => ({ results: db.prepare(sql).all(...p) }) }) };
    },
  },
} as never);

/** A form post carrying several `id` fields, as the checkboxes send them. */
const postIds = (h: Harness, path: string, ids: string[]): Promise<Response> =>
  h.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' },
    body: new URLSearchParams([['_csrf', 'test-csrf-token'], ...ids.map((id) => ['id', id])]),
  });

const refs = async (db: ReturnType<typeof register>['db']) =>
  (await dormantClients(envFor(db), TODAY)).map((r) => r.ref);

describe('who looks finished with', () => {
  it('proposes a client with everything expired and no matter running', () => {
    const { db, client, matter } = register();
    client('c1', 'CL-9001', '2025-01-01');
    matter('k1', 'c1', 'approved', AT);
    return expect(refs(db)).resolves.toEqual(['CL-9001']);
  });

  it('leaves a client with a matter still running', async () => {
    // The person is here. Whatever their documents say.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', '2025-01-01');
    matter('k1', 'c1', 'lodged');
    expect(await refs(db)).toEqual([]);
  });

  it('counts a matter merely being prepared as running', async () => {
    // Not "no open case" — nothing at any working status. A matter being
    // prepared means somebody is acting for them right now.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', '2025-01-01');
    matter('k1', 'c1', 'gathering_documents');
    expect(await refs(db)).toEqual([]);
  });

  it('leaves a client with one document still in date', async () => {
    // A passport good until 2029 says somebody expects to use it. One live
    // document is enough.
    const { db, client, passport } = register();
    client('c1', 'CL-9001', '2025-01-01');
    passport('p1', 'c1', '2029-01-01');
    expect(await refs(db)).toEqual([]);
  });

  it('leaves a client with nothing on file at all', async () => {
    // Otherwise somebody taken on this morning would be proposed for archiving
    // on their first day.
    const { db, client } = register();
    client('c1', 'CL-9001', null);
    expect(await refs(db)).toEqual([]);
  });

  it('leaves a client already archived', async () => {
    const { db, client } = register();
    client('c1', 'CL-9001', '2025-01-01', 'archived');
    expect(await refs(db)).toEqual([]);
  });

  it('ignores a passport that is no longer held', async () => {
    // A replaced passport is not evidence of anything; it is history.
    const { db, client, passport } = register();
    client('c1', 'CL-9001', null);
    passport('p1', 'c1', '2025-01-01', 'replaced');
    expect(await refs(db)).toEqual([]);
  });

  it('counts every kind of document that expires', async () => {
    const { db, client, passport, cert } = register();
    client('c1', 'CL-9001', '2025-01-01');
    passport('p1', 'c1', '2025-02-01');
    cert('cc1', 'c1', '2025-03-01');
    const [row] = await dormantClients(envFor(db), TODAY);
    expect(row!.expired).toBe(3);
    // The most recent expiry: roughly when they stopped needing us.
    expect(row!.last_expiry).toBe('2025-03-01');
  });

  it('says how many matters are on the file, all of them finished', async () => {
    const { db, client, matter } = register();
    client('c1', 'CL-9001', '2025-01-01');
    matter('k1', 'c1', 'approved', AT);
    matter('k2', 'c1', 'withdrawn', AT);
    expect((await dormantClients(envFor(db), TODAY))[0]!.matters).toBe(2);
  });

  it('puts the longest-gone first', async () => {
    const { db, client, matter } = register();
    client('c1', 'CL-9001', '2026-01-01');
    client('c2', 'CL-9002', '2022-01-01');
    matter('k1', 'c1', 'approved', AT);
    matter('k2', 'c2', 'approved', AT);
    expect(await refs(db)).toEqual(['CL-9002', 'CL-9001']);
  });

  it('treats a document expiring today as still in date', async () => {
    // Today is not "expired". Somebody could still be using it this afternoon.
    const { db, client } = register();
    client('c1', 'CL-9001', TODAY);
    expect(await refs(db)).toEqual([]);
  });
});

describe('re-checking before anything is written', () => {
  it('drops somebody who has a matter running again', async () => {
    // Between proposing and applying, a matter may have been opened — and the
    // person pressing the button cannot see that.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', '2025-01-01');
    client('c2', 'CL-9002', '2025-01-01');
    matter('k1', 'c1', 'approved', AT);
    matter('k2', 'c2', 'lodged');
    const allowed = await stillDormant(envFor(db), TODAY, ['c1', 'c2']);
    expect([...allowed]).toEqual(['c1']);
  });

  it('refuses an id that was never proposed', async () => {
    // The ids arrive in a form. Anything not on the register's own list is not
    // archived, whatever the form said.
    const { db, client, matter } = register();
    client('c1', 'CL-9001', '2025-01-01');
    matter('k1', 'c1', 'approved', AT);
    const allowed = await stillDormant(envFor(db), TODAY, ['c1', 'somebody-else']);
    expect([...allowed]).toEqual(['c1']);
  });

  it('returns nothing for an empty list, without asking the database', async () => {
    let asked = 0;
    const db = { prepare() { asked++; throw new Error('should not run'); } } as never;
    expect([...await stillDormant(db, TODAY, [])]).toEqual([]);
    expect(asked).toBe(0);
  });
});

/**
 * The two routes, exercised as a request exercises them.
 *
 * An earlier version of these tests read the handler's source and asserted on
 * the strings in it. Mutation testing showed what that was worth: the route was
 * changed to call the re-check and then ignore what it said — archiving a
 * client whose matter had been reopened — and all of them still passed. So they
 * go through the real handler now, and check the database afterwards.
 */
describe('archiving is reversible and leaves a trail', () => {
  const TODAY = new Date().toISOString().slice(0, 10);
  const YEAR = Number(TODAY.slice(0, 4));
  const GONE = `${YEAR - 2}-01-01`;
  const AHEAD = `${YEAR + 3}-01-01`;

  function seed(h: Harness, user: User) {
    h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
                  VALUES (?, ?, ?, 'x', ?, ?, ?)`).run(user.id, user.email, user.name, user.role, AT, AT);
    const client = (id: string, ref: string, visa: string | null, status = 'active') =>
      h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, current_visa_expiry,
                                         created_at, updated_at)
                    VALUES (?, ?, 'individual', ?, ?, ?, ?, ?)`)
        .run(id, ref, `Person ${ref}`, status, visa, AT, AT);
    const matter = (id: string, clientId: string, status: string, closed: string | null = null) =>
      h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                       closed_at, created_at, updated_at)
                    VALUES (?, ?, ?, 'A matter', 'wv_aewv', ?, ?, ?, ?, ?)`)
        .run(id, `CASE-26-${id}`, clientId, status, user.id, closed, AT, AT);
    return { client, matter };
  }

  /** Two clients who look finished with, and the harness they live in. */
  function twoGone(role: User['role'] = 'admin') {
    const user = fakeUser({ role });
    const h = mountModule(clientsModule, { user });
    const { client, matter } = seed(h, user);
    client('c1', 'CL-9001', GONE);
    client('c2', 'CL-9002', GONE);
    matter('k1', 'c1', 'closed', AT);
    return { h, user, client, matter };
  }

  const status = (h: Harness, id: string) =>
    h.get<{ status: string }>('SELECT status FROM clients WHERE id = ?', id)?.status;

  it('sets a status rather than deleting anything', async () => {
    const { h } = twoGone();
    const res = await postIds(h, '/clients/archive/confirm', ['c1', 'c2']);
    expect(res.status).toBe(303);
    expect(status(h, 'c1')).toBe('archived');
    expect(status(h, 'c2')).toBe('archived');
    // Nothing left the register.
    expect(h.count('SELECT COUNT(*) AS n FROM clients')).toBe(2);
    expect(h.count('SELECT COUNT(*) AS n FROM cases')).toBe(1);
  });

  it('writes a note on the file and an audit row for each one', async () => {
    const { h } = twoGone();
    await postIds(h, '/clients/archive/confirm', ['c1', 'c2']);
    for (const id of ['c1', 'c2']) {
      expect(h.count(
        `SELECT COUNT(*) AS n FROM entries WHERE entity_type = 'client' AND entity_id = ?`, id)).toBe(1);
      const audit = h.get<{ meta_json: string }>(
        `SELECT meta_json FROM audit_log WHERE action = 'client.status_changed' AND entity_id = ?`, id);
      expect(audit).not.toBeNull();
      expect(JSON.parse(audit!.meta_json)).toMatchObject({ from: 'active', to: 'archived', bulk: true });
    }
  });

  it('confirms on a page rather than in a dialog', async () => {
    const { h } = twoGone();
    const res = await postIds(h, '/clients/archive', ['c1', 'c2']);
    expect(res.status).toBe(200);
    const body = await res.text();
    // Both names shown, and a second press still to come.
    expect(body).toContain('Person CL-9001');
    expect(body).toContain('Person CL-9002');
    expect(body).toContain('/clients/archive/confirm');
    expect(body).not.toMatch(/data-confirm/);
    // The first step writes nothing.
    expect(status(h, 'c1')).toBe('active');
    expect(status(h, 'c2')).toBe('active');
  });

  it('re-reads before writing rather than trusting the form', async () => {
    const { h, matter } = twoGone();
    // Between proposing and pressing, a matter is opened for c1.
    matter('k2', 'c1', 'preparing');
    await postIds(h, '/clients/archive/confirm', ['c1', 'c2']);
    expect(status(h, 'c1')).toBe('active');
    expect(status(h, 'c2')).toBe('archived');
  });

  it('refuses a client who was never proposed', async () => {
    const { h, client } = twoGone();
    client('c3', 'CL-9003', AHEAD);  // visa good for years yet
    await postIds(h, '/clients/archive/confirm', ['c3']);
    expect(status(h, 'c3')).toBe('active');
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = 'c3'`)).toBe(0);
  });

  it('needs permission to write to the register', async () => {
    const { h } = twoGone('readonly');
    for (const path of ['/clients/archive', '/clients/archive/confirm']) {
      const res = await postIds(h, path, ['c1']);
      expect(res.status).toBe(403);
    }
    expect(status(h, 'c1')).toBe('active');
  });
});
