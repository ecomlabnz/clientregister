/**
 * The backup button.
 *
 * **Asked for on 9 September 2026:** *"i need you to make one full back up copy
 * of all data in the register in a zip file for download"*, then *"include the
 * passport numbers - the whole lot"*, then *"one button - but only available to
 * owner"*.
 *
 * Three things have to be true of a backup, and only the first is obvious:
 *
 * 1. **It is a real zip.** Nothing here uses a zip library, so the format is
 *    written by hand and could be subtly wrong in a way that opens in one tool
 *    and not another. So the archive is taken apart here the way a stranger's
 *    tool would take it apart — from the end-of-central-directory record
 *    backwards — rather than by reading back the object that made it.
 * 2. **It holds everything.** A backup missing a column cannot restore the
 *    register, which is the one job it has. Passport numbers included, by the
 *    practice's decision; the standing rule keeps those out of *exports*, and
 *    the tests below assert both halves so neither drifts into the other.
 * 3. **Only the owner may take one.** It is the practice's whole book of
 *    business in a downloads folder. An administrator can do everything else
 *    in this section and cannot do this.
 */

import { describe, expect, it } from 'vitest';
import { adminModule } from '../src/modules/admin';
import { loadOrder } from '../src/core/backup';
import { fakeUser, mountModule } from './support/d1';

// Through the runtime rather than an import, for the same reason
// `test/support/d1.ts` reaches for `node:sqlite` that way: the bundler this
// suite runs under does not resolve node builtins here.
const { inflateRawSync } = process.getBuiltinModule('node:zlib');
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const at = '2026-09-09T00:00:00Z';

function seed(db: any) {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u_test', 'tester@example.test', 'A Tester', 'x', 'owner', ?, ?)`).run(at, at);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, passport_number,
                                   created_at, updated_at)
              VALUES ('cl_1', 'CL-0001', 'individual', 'Marama TE WHARE', 'active', 'LA9911223', ?, ?)`)
    .run(at, at);
  // An apostrophe and a newline, because the SQL half of the archive is built
  // by quoting values by hand and both are how that goes wrong.
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, address, created_at, updated_at)
              VALUES ('cl_2', 'CL-0002', 'individual', 'Aroha O''CONNELL', 'active',
                      '12 King''s Road' || char(10) || 'Ōtautahi', ?, ?)`).run(at, at);
}

/** Take a zip apart from its end-of-central-directory record, as a reader does. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  expect(eocd, 'no end-of-central-directory record').toBeGreaterThanOrEqual(0);

  const entries = view.getUint16(eocd + 10, true);
  let at2 = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();

  for (let n = 0; n < entries; n++) {
    expect(view.getUint32(at2, true)).toBe(0x02014b50);
    const method = view.getUint16(at2 + 10, true);
    const crc = view.getUint32(at2 + 16, true);
    const packed = view.getUint32(at2 + 20, true);
    const plain = view.getUint32(at2 + 24, true);
    const nameLen = view.getUint16(at2 + 28, true);
    const extraLen = view.getUint16(at2 + 30, true);
    const commentLen = view.getUint16(at2 + 32, true);
    const offset = view.getUint32(at2 + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at2 + 46, at2 + 46 + nameLen));

    // Follow the offset to the local header, which is what a reader actually
    // reads the bytes from — a central directory that points at the wrong place
    // is the classic hand-rolled-zip fault and would pass a self-consistency
    // check.
    expect(view.getUint32(offset, true), `${name}: local header`).toBe(0x04034b50);
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    expect(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + localName))).toBe(name);
    const start = offset + 30 + localName + localExtra;
    const body = bytes.subarray(start, start + packed);
    const raw = method === 8 ? new Uint8Array(inflateRawSync(body)) : body;
    expect(raw.length, `${name}: uncompressed size`).toBe(plain);

    // The CRC the header claims, recomputed over what came out.
    let sum = 0xffffffff;
    for (let i = 0; i < raw.length; i++) {
      sum ^= raw[i]!;
      for (let bit = 0; bit < 8; bit++) sum = (sum >>> 1) ^ (0xedb88320 & -(sum & 1));
    }
    expect((sum ^ 0xffffffff) >>> 0, `${name}: CRC`).toBe(crc);

    out.set(name, raw);
    at2 += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** `data/017_clients.sql` — found by table, since the number is the order. */
const dataFor = (files: Map<string, Uint8Array>, table: string): string => {
  const key = [...files.keys()].find((k) => k.replace(/^data\/\d+_/, 'data/') === `data/${table}.sql`);
  expect(key, `no data file for ${table}`).toBeDefined();
  return new TextDecoder().decode(files.get(key!)!);
};

const text = (files: Map<string, Uint8Array>, name: string): string => {
  const bytes = files.get(name);
  expect(bytes, `${name} is not in the archive`).toBeDefined();
  return new TextDecoder().decode(bytes!);
};

async function take(user = fakeUser({ role: 'owner' }), env?: Record<string, unknown>) {
  const h = mountModule(adminModule, { user, env });
  seed(h.db);
  const res = await h.post('/admin/backup');
  return { h, res };
}

describe('a backup is a real zip', () => {
  it('opens from its central directory, every entry intact', async () => {
    const { res } = await take();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-disposition'))
      .toMatch(/^attachment; filename="client-register-backup-\d{4}-\d{2}-\d{2}\.zip"$/);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const files = unzip(new Uint8Array(await res.arrayBuffer()));

    // The vacuity guard: a walker that found nothing would make every
    // assertion below pass by describing an empty archive.
    expect(files.size).toBeGreaterThan(100);
    expect([...files.keys()].filter((k) => k.startsWith('data/')).length).toBeGreaterThan(40);
    expect([...files.keys()].filter((k) => k.startsWith('tables/')).length).toBeGreaterThan(40);
  });

  it('carries the schema, the rows and a manifest that agrees with them', async () => {
    const { res } = await take();
    const files = unzip(new Uint8Array(await res.arrayBuffer()));

    expect(text(files, 'schema.sql')).toContain('CREATE TABLE clients');
    // The triggers are a separate file, and deliberately not in this one: they
    // go on after the data, not before it.
    expect(text(files, 'schema.sql')).not.toContain('CREATE TRIGGER');
    expect(text(files, 'triggers.sql')).toContain('CREATE TRIGGER');

    const manifest = JSON.parse(text(files, 'manifest.json'));
    expect(manifest.taken_by).toBe('A Tester <tester@example.test>');
    expect(manifest.contains_passport_numbers).toBe(true);
    const clients = manifest.tables.find((t: any) => t.name === 'clients');
    expect(clients.rows).toBe(2);
    expect(manifest.total_rows)
      .toBe(manifest.tables.reduce((n: number, t: any) => n + t.rows, 0));

    expect(text(files, 'README.md')).toContain('entire client file');
  });

  it('quotes a value that would otherwise break the SQL', async () => {
    const { res } = await take();
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    const sql = dataFor(files, 'clients');

    // Doubled, which is SQLite's only escape, and the newline kept as itself.
    expect(sql).toContain("'Aroha O''CONNELL'");
    expect(sql).toContain("'12 King''s Road\nŌtautahi'");

    // The rows are also there as JSON, where the escaping is somebody else's.
    const rows = JSON.parse(text(files, 'tables/clients.json'));
    expect(rows.map((r: any) => r.full_name).sort())
      .toEqual(['Aroha O\'CONNELL', 'Marama TE WHARE']);
  });

  it('includes the passport numbers, which the CSV export does not', async () => {
    const { h, res } = await take();
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect(dataFor(files, 'clients')).toContain('LA9911223');
    expect(text(files, 'tables/clients.json')).toContain('LA9911223');

    // The other half of the same rule, asserted here so the two cannot drift:
    // a backup restores, an export is read elsewhere, and only one of them
    // carries the number.
    const csv = await (await h.request('/admin/export/clients.csv')).text();
    expect(csv).not.toContain('LA9911223');
  });

  it('brings the files from R2, under the keys the register stores', async () => {
    const stored = new TextEncoder().encode('%PDF-1.7 a passport scan');
    const DOCS = {
      get: async (key: string) => (key === 'docs/cl_1/passport.pdf' ? {
        arrayBuffer: async () => stored.buffer.slice(0),
      } : null),
    };
    const user = fakeUser({ role: 'owner' });
    const h = mountModule(adminModule, { user, env: { DOCS } });
    seed(h.db);
    h.db.prepare(`INSERT INTO documents (id, entity_type, entity_id, filename, r2_key,
                                         content_type, size_bytes, uploaded_at, uploaded_by)
                  VALUES ('doc_1', 'client', 'cl_1', 'passport.pdf', 'docs/cl_1/passport.pdf',
                          'application/pdf', ?, ?, 'u_test')`).run(stored.length, at);
    // A row whose file has gone missing must not take the whole backup down.
    h.db.prepare(`INSERT INTO documents (id, entity_type, entity_id, filename, r2_key,
                                         content_type, size_bytes, uploaded_at, uploaded_by)
                  VALUES ('doc_2', 'client', 'cl_1', 'gone.pdf', 'docs/cl_1/gone.pdf',
                          'application/pdf', 10, ?, 'u_test')`).run(at);

    const res = await h.post('/admin/backup');
    expect(res.status).toBe(200);
    const files = unzip(new Uint8Array(await res.arrayBuffer()));
    expect(files.get('files/docs/cl_1/passport.pdf')).toEqual(stored);
    expect(files.has('files/docs/cl_1/gone.pdf')).toBe(false);
    expect(JSON.parse(text(files, 'manifest.json')).files).toBe(1);
  });
});

describe('and it restores', () => {
  /**
   * The test the others were standing in for.
   *
   * The first version of this backup produced an archive that passed every
   * check above and could not be restored: the data files were in alphabetical
   * order, so `case_parties` loaded before `cases` and `invoice_items` before
   * `invoices`, and 36 of 51 tables were refused on foreign keys. The restored
   * database had no clients in it. That was found by taking a real backup and
   * replaying it, which is what this now does on every run — into an empty
   * SQLite, through the same three steps the README tells a person to run, with
   * foreign keys ON so that a wrong order fails here rather than in the week it
   * is needed.
   */
  it('replays into an empty database with foreign keys on, and the records come back', async () => {
    const h = mountModule(adminModule, { user: fakeUser({ role: 'owner' }) });
    seed(h.db);
    // Rows across the tables that reference one another, since the whole point
    // is the order between them.
    h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                     created_at, updated_at)
                  VALUES ('k_1', 'CASE-26-001', 'cl_1', 'Partnership', 'rv_partnership',
                          'open', 'u_test', ?, ?)`).run(at, at);
    h.db.prepare(`INSERT INTO case_parties (id, case_id, client_id, role, created_at)
                  VALUES ('cp_1', 'k_1', 'cl_2', 'partner', ?)`).run(at);

    const files = unzip(new Uint8Array(await (await h.post('/admin/backup')).arrayBuffer()));

    const fresh = new DatabaseSync(':memory:');
    fresh.exec('PRAGMA foreign_keys = ON;');
    fresh.exec(text(files, 'schema.sql'));

    const steps = [...files.keys()].filter((k) => k.startsWith('data/')).sort();
    expect(steps.length).toBeGreaterThan(40);
    // Every one of them, and a throw is the failure — no counting of how many
    // "mostly" worked, which is how the first version looked fine.
    for (const step of steps) fresh.exec(text(files, step));
    fresh.exec(text(files, 'triggers.sql'));

    const rows = (sql: string) => (fresh.prepare(sql) as any).all() as any[];
    expect(rows('SELECT ref FROM clients ORDER BY ref').map((r) => r.ref))
      .toEqual(['CL-0001', 'CL-0002']);
    expect(rows(`SELECT passport_number AS p FROM clients WHERE ref = 'CL-0001'`)[0].p)
      .toBe('LA9911223');
    expect(rows(`SELECT address AS a FROM clients WHERE ref = 'CL-0002'`)[0].a)
      .toBe("12 King's Road\nŌtautahi");
    expect(rows('SELECT case_id, client_id FROM case_parties')).toEqual([
      { case_id: 'k_1', client_id: 'cl_2' },
    ]);

    // The rules came back with it, not merely the rows: a restored register
    // that no longer refuses what it used to refuse is a different register.
    const triggers = rows(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger'`)[0].n;
    expect(triggers).toBeGreaterThan(60);
    // Migration 0073's rule: an INZ client number is digits, six to twelve.
    expect(() => fresh.exec(`UPDATE clients SET inz_client_number = 'ABC123'
                              WHERE ref = 'CL-0001'`)).toThrow(/INZ client number/i);
    fresh.exec(`UPDATE clients SET inz_client_number = '80012345' WHERE ref = 'CL-0001'`);
  });

  it('restores two rows that point at each other, which no order could', () => {
    // The organisation names its main contact; that contact's organisation is
    // the organisation. Whichever is written first refers to a row that does
    // not exist yet, so the columns go in empty and are set at the end of the
    // file. Found by restoring a real backup: sorting the rows got 274 of 278
    // clients in and refused the four that formed the loop.
    const h = mountModule(adminModule, { user: fakeUser({ role: 'owner' }) });
    seed(h.db);
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES ('cl_org', 'CL-0003', 'organisation', 'Kōwhai Orchards Ltd', 'active', ?, ?)`)
      .run(at, at);
    h.db.exec(`UPDATE clients SET primary_contact_id = 'cl_1' WHERE id = 'cl_org';
               UPDATE clients SET organisation_id = 'cl_org' WHERE id = 'cl_1';`);

    return h.post('/admin/backup').then(async (res) => {
      const files = unzip(new Uint8Array(await res.arrayBuffer()));
      const sql = dataFor(files, 'clients');

      // Empty on the way in, set on the way out — and both, or the loop is
      // only half broken.
      expect(sql).toMatch(/UPDATE "clients" SET "primary_contact_id" = 'cl_1'/);
      expect(sql).toMatch(/UPDATE "clients" SET "organisation_id" = 'cl_org'/);

      const fresh = new DatabaseSync(':memory:');
      fresh.exec('PRAGMA foreign_keys = ON;');
      fresh.exec(text(files, 'schema.sql'));
      for (const step of [...files.keys()].filter((k) => k.startsWith('data/')).sort()) {
        fresh.exec(text(files, step));
      }
      const back = (fresh.prepare(
        `SELECT id, organisation_id, primary_contact_id FROM clients
          WHERE organisation_id IS NOT NULL OR primary_contact_id IS NOT NULL ORDER BY id`,
      ) as any).all();
      expect(back).toEqual([
        { id: 'cl_1', organisation_id: 'cl_org', primary_contact_id: null },
        { id: 'cl_org', organisation_id: null, primary_contact_id: 'cl_1' },
      ]);
    });
  });

  it('orders a table after everything it points at', () => {
    const order = loadOrder([
      { name: 'invoice_items', sql: 'CREATE TABLE invoice_items (invoice_id REFERENCES invoices(id))' },
      { name: 'invoices', sql: 'CREATE TABLE invoices (client_id REFERENCES clients(id))' },
      { name: 'clients', sql: 'CREATE TABLE clients (id TEXT PRIMARY KEY)' },
    ]);
    expect(order).toEqual(['clients', 'invoices', 'invoice_items']);
  });

  it('keeps a table whose references form a loop rather than dropping it', () => {
    // A wrong order costs a foreign-key complaint somebody can work around. A
    // missing table costs the records in it.
    const order = loadOrder([
      { name: 'a', sql: 'CREATE TABLE a (b_id REFERENCES b(id))' },
      { name: 'b', sql: 'CREATE TABLE b (a_id REFERENCES a(id))' },
      { name: 'c', sql: 'CREATE TABLE c (id TEXT)' },
    ]);
    expect(order.sort()).toEqual(['a', 'b', 'c']);
  });

  it('does not treat a table pointing at itself as a loop', () => {
    const order = loadOrder([
      { name: 'tasks', sql: 'CREATE TABLE tasks (parent_id REFERENCES tasks(id), c REFERENCES cases(id))' },
      { name: 'cases', sql: 'CREATE TABLE cases (id TEXT)' },
    ]);
    expect(order).toEqual(['cases', 'tasks']);
  });
});

describe("what belongs to D1 rather than to the register", () => {
  /**
   * The fault this pins was found by pressing the button, not by this suite.
   *
   * D1 keeps a `_cf_METADATA` table. `sqlite_master` lists it, and D1 then
   * refuses to read it — `access to _cf_METADATA.key is prohibited:
   * SQLITE_AUTH` — so the first version took the whole database down with a 500
   * on the first press, while passing every test here, because the SQLite these
   * tests run on has no such table. It does now: the table is created in the
   * scratch database so the exclusion is a rule this suite can actually check.
   */
  it('is left alone, so the archive is only what is ours to restore', async () => {
    const h = mountModule(adminModule, { user: fakeUser({ role: 'owner' }) });
    seed(h.db);
    h.db.exec(`CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB);
               INSERT INTO _cf_METADATA VALUES (1, 'd1 bookkeeping');`);

    const res = await h.post('/admin/backup');
    expect(res.status).toBe(200);
    const files = unzip(new Uint8Array(await res.arrayBuffer()));

    // The guard against a pass by absence: the table really is in the database
    // the archive was taken from.
    expect(h.count(`SELECT COUNT(*) AS n FROM _cf_METADATA`)).toBe(1);

    expect([...files.keys()].some((k) => k.includes('_cf_METADATA'))).toBe(false);
    expect(files.has('tables/_cf_METADATA.json')).toBe(false);
    expect(text(files, 'schema.sql')).not.toContain('_cf_METADATA');
    expect(JSON.parse(text(files, 'manifest.json')).tables
      .some((t: any) => t.name.startsWith('_cf_'))).toBe(false);

    // And the register's own tables are still all there.
    expect(text(files, 'schema.sql')).toContain('CREATE TABLE clients');
  });
});

describe('only the owner may take one', () => {
  for (const role of ['admin', 'adviser', 'assistant', 'readonly'] as const) {
    it(`refuses ${role}`, async () => {
      const h = mountModule(adminModule, { user: fakeUser({ role }) });
      seed(h.db);
      expect((await h.post('/admin/backup')).status).toBe(403);
    });
  }

  it('and does not show them the button', async () => {
    for (const role of ['admin', 'owner'] as const) {
      const h = mountModule(adminModule, { user: fakeUser({ role }) });
      seed(h.db);
      const body = await (await h.request('/admin/export')).text();
      expect(body.includes('Download a full backup'), role).toBe(role === 'owner');
    }
  });
});

describe('taking one is recorded', () => {
  it('writes what was taken, not merely that something was', async () => {
    const { h, res } = await take();
    expect(res.status).toBe(200);

    const row = h.get<{ action: string; entity_type: string; meta_json: string }>(
      `SELECT action, entity_type, meta_json FROM audit_log WHERE action = 'admin.backup_taken'`);
    expect(row).not.toBeNull();
    expect(row!.entity_type).toBe('backup');
    const meta = JSON.parse(row!.meta_json);
    expect(meta.rows).toBeGreaterThan(0);
    expect(meta.tables).toBeGreaterThan(40);
    expect(meta.zip_bytes).toBeGreaterThan(0);
    expect(meta.contains_passport_numbers).toBe(true);
  });
});
