import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * An inquiry can be deleted, but only while it is still only an inquiry.
 *
 * Not everything that arrives is work, and a list that fills with things nobody
 * will act on stops being read. But an inquiry that has become a matter, a
 * quote, a task or a file note is load-bearing, and deleting it would leave
 * that something pointing at nothing.
 *
 * Attacked through the database rather than through the application: the rule
 * is a guarantee about the data, and a guarantee that lives in the route that
 * happens to run the DELETE lasts until somebody adds a second route.
 */

const module_ = readFileSync('src/modules/inquiries/index.ts', 'utf8');
const at = '2026-01-01T00:00:00Z';

function seeded() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1', 'a@b.test', 'An Adviser', 'x', 'adviser', ?, ?)`).run(at, at);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1', 'CL-1', 'individual', 'A PERSON', 'active', ?, ?)`).run(at, at);
  return db;
}

type Db = ReturnType<typeof seeded>;

/** An inquiry as the application makes one: with its system breadcrumb. */
function inquiry(db: Db, id: string, extra: { client?: string; case?: string } = {}) {
  db.prepare(`INSERT INTO inquiries (id, ref, source, received_at, status, client_id, case_id,
                                     created_at, updated_at)
              VALUES (?, ?, 'telegram', ?, 'new', ?, ?, ?, ?)`)
    .run(id, `ENQ-${id}`, at, extra.client ?? null, extra.case ?? null, at, at);
  db.prepare(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
              VALUES (?, 'inquiry', ?, 'system', 'Inquiry received via Telegram.', ?, ?)`)
    .run(`e_${id}`, id, at, at);
}

const remove = (db: Db, id: string) => db.prepare('DELETE FROM inquiries WHERE id = ?').run(id);

/** The first row of a query. The workers-types shim for node:sqlite has no `get`. */
const row = (db: Db, sql: string): Record<string, unknown> | undefined =>
  (db.prepare(sql).all() as Array<Record<string, unknown>>)[0];

function matter(db: Db) {
  db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                 created_at, updated_at)
              VALUES ('k1', 'CASE-1', 'c1', 'A matter', 'wv_aewv', 'lead', 'u1', ?, ?)`).run(at, at);
}

describe('noise can be cleared', () => {
  it('deletes an inquiry that never became anything', () => {
    const db = seeded();
    inquiry(db, 'i1');
    expect(() => remove(db, 'i1')).not.toThrow();
    expect(row(db, 'SELECT COUNT(*) AS n FROM inquiries')).toEqual({ n: 0 });
  });

  it('deletes one merely linked to a client', () => {
    // The matcher fills client_id in whenever a known number writes in. That
    // makes it a message from somebody on the register, not a record of work.
    const db = seeded();
    inquiry(db, 'i1', { client: 'c1' });
    expect(() => remove(db, 'i1')).not.toThrow();
    expect(row(db, `SELECT COUNT(*) AS n FROM clients WHERE id = 'c1'`)).toEqual({ n: 1 });
  });

  it('leaves the system breadcrumb where it is, rather than rewriting history', () => {
    // Entries are append-only since 0014 and this does not carve an exception
    // into that. The row is orphaned, which is the honest cost of a record that
    // cannot be deleted.
    const db = seeded();
    inquiry(db, 'i1');
    remove(db, 'i1');
    expect(row(db, `SELECT COUNT(*) AS n FROM entries WHERE entity_id = 'i1'`)).toEqual({ n: 1 });
  });
});

describe('the database refuses to delete an inquiry that carries something', () => {
  const cases: Array<[string, (db: Db) => void, RegExp]> = [
    ['a matter', (db) => { matter(db); inquiry(db, 'i1', { case: 'k1' }); }, /became a matter/],
    ['a quote', (db) => {
      inquiry(db, 'i1');
      db.prepare(`INSERT INTO quotes (id, ref, client_id, inquiry_id, status, currency, description,
                                      amount_cents, created_at, updated_at)
                  VALUES ('q1', 'Q-1', 'c1', 'i1', 'draft', 'NZD', 'Some work', 0, ?, ?)`).run(at, at);
    }, /has been quoted/],
    ['a task', (db) => {
      inquiry(db, 'i1');
      db.prepare(`INSERT INTO tasks (id, title, status, entity_type, entity_id, assigned_to,
                                     created_at, updated_at)
                  VALUES ('t1', 'Ring back', 'open', 'inquiry', 'i1', 'u1', ?, ?)`).run(at, at);
    }, /with tasks/],
    ['a file note', (db) => {
      inquiry(db, 'i1');
      db.prepare(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
                  VALUES ('e_note', 'inquiry', 'i1', 'note', 'Rang them back.', ?, ?)`).run(at, at);
    }, /with a file note/],
    ['a document', (db) => {
      inquiry(db, 'i1');
      db.prepare(`INSERT INTO documents (id, entity_type, entity_id, r2_key, filename, content_type,
                                         size_bytes, uploaded_at)
                  VALUES ('d1', 'inquiry', 'i1', 'k', 'passport.pdf', 'application/pdf', 10, ?)`).run(at);
    }, /with documents/],
  ];

  for (const [what, arrange, message] of cases) {
    it(`refuses one with ${what}`, () => {
      const db = seeded();
      arrange(db);
      expect(() => remove(db, 'i1')).toThrow(message);
      // And the row is still there afterwards, not half-deleted.
      expect(row(db, 'SELECT COUNT(*) AS n FROM inquiries')).toEqual({ n: 1 });
    });
  }
});

describe('the message an inquiry was made from', () => {
  it('is settled rather than left looking unhandled', () => {
    // A foreign key declared ON DELETE SET NULL is applied before an AFTER
    // DELETE trigger runs, so this has to happen on the way out. Getting that
    // wrong left the message silently as it was, which is why it is pinned.
    const db = seeded();
    inquiry(db, 'i1');
    db.prepare(`INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status,
                                             inquiry_id, created_at)
                VALUES ('m1', 'telegram', 'd1', ?, 'processed', 'i1', ?)`).run(at, at);
    remove(db, 'i1');
    expect(row(db, `SELECT status, inquiry_id FROM ingest_messages WHERE id = 'm1'`))
      .toEqual({ status: 'ignored', inquiry_id: null });
  });

  it('is left alone when the delete is refused', () => {
    const db = seeded();
    matter(db);
    inquiry(db, 'i1', { case: 'k1' });
    db.prepare(`INSERT INTO ingest_messages (id, channel, dedupe_key, received_at, status,
                                             inquiry_id, created_at)
                VALUES ('m1', 'telegram', 'd1', ?, 'processed', 'i1', ?)`).run(at, at);
    expect(() => remove(db, 'i1')).toThrow();
    expect(row(db, `SELECT status FROM ingest_messages WHERE id = 'm1'`))
      .toEqual({ status: 'processed' });
  });
});

describe('what the screen offers', () => {
  it('needs the delete permission, not merely write', () => {
    expect(module_).toContain("requirePermission('register:delete')");
    expect(module_).toContain("can(c.get('user'), 'register:delete')");
  });

  it('confirms first, through the attribute the content policy allows', () => {
    // An inline onsubmit would be blocked silently, leaving a destructive
    // button with no confirmation at all.
    expect(module_).toContain('confirm: `Delete ${row.ref}?');
    expect(module_).not.toContain('onsubmit');
  });

  it('is not offered on an inquiry that has become a matter', () => {
    expect(module_).toContain('row.case_id');
    expect(module_).toContain("can(c.get('user'), 'register:delete') && !inq.case_id");
  });

  it('records what the inquiry was before deleting it', () => {
    // Once the row is gone there is nothing left to describe it, so the audit
    // entry has to be written first and has to carry the details.
    const route = module_.slice(module_.indexOf("r.post('/:id/delete'"));
    const audit = route.indexOf("action: 'inquiry.deleted'");
    const del = route.indexOf('DELETE FROM inquiries');
    expect(audit).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(del);
    expect(route.slice(audit, del)).toContain('ref: inq.ref');
  });
});
