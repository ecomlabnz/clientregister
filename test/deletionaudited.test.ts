import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * A record that leaves the register says so.
 *
 * A client file was once removed by a DELETE run straight against production.
 * There is no route that deletes a client, so there was no other way — and a
 * statement run by hand writes nothing to the audit log. The file left and
 * nothing anywhere said so. The audit row belongs to the database, not to
 * whichever handler, load or console happened to make the change, so these
 * tests attack the tables directly rather than going through the application.
 */

const at = '2026-07-01T00:00:00Z';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1', 'a@b.test', 'A Lawyer', 'x', 'owner', ?, ?)`).run(at, at);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at, created_by)
              VALUES ('c1', 'CL-9001', 'individual', 'Hemi Rangi TAWHAI', 'active', ?, ?, 'u1')`)
    .run(at, at);
  db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                 created_at, updated_at, created_by)
              VALUES ('k1', 'CASE-26-901', 'c1', 'A resident visa', 'rv_resident', 'open', 'u1', ?, ?, 'u1')`)
    .run(at, at);
  return db;
}

type Db = ReturnType<typeof register>;
const audit = (db: Db) =>
  db.prepare('SELECT * FROM audit_log ORDER BY action').all() as Array<Record<string, string | undefined>>;

describe('a deletion writes its own audit row', () => {
  it('records the client, its reference and its name', () => {
    const db = register();
    db.exec("DELETE FROM cases WHERE id = 'k1'");
    db.exec("DELETE FROM clients WHERE id = 'c1'");

    const rows = audit(db);
    const client = rows.find((r) => r.action === 'client.deleted');
    expect(client).toBeTruthy();
    expect(client!.entity_type).toBe('client');
    expect(client!.entity_id).toBe('c1');
    expect(client!.actor_label).toBe('database');
    const meta = JSON.parse(client!.meta_json!) as Record<string, string>;
    expect(meta.ref).toBe('CL-9001');
    expect(meta.full_name).toBe('Hemi Rangi TAWHAI');
    expect(meta.note).toMatch(/retired/);
  });

  it('records a matter, and its reference, when a matter is deleted', () => {
    const db = register();
    db.exec("DELETE FROM cases WHERE id = 'k1'");
    const row = audit(db).find((r) => r.action === 'case.deleted');
    expect(row).toBeTruthy();
    expect(JSON.parse(row!.meta_json!).ref).toBe('CASE-26-901');
  });

  it('accounts for every matter that goes with a client, not just the client', () => {
    // Deleting a client cascades to its matters. A cascade is exactly the case
    // where a handler-written audit row is missed, because no handler ran.
    const db = register();
    db.exec("DELETE FROM clients WHERE id = 'c1'");
    const actions = audit(db).map((r) => r.action);
    expect(actions).toContain('client.deleted');
    expect(actions).toContain('case.deleted');
  });

  it('leaves the audit row behind — it cannot be deleted with the record', () => {
    const db = register();
    db.exec("DELETE FROM clients WHERE id = 'c1'");
    expect(() => db.exec("DELETE FROM audit_log WHERE entity_id = 'c1'")).toThrow(/append-only/);
    expect(audit(db).length).toBe(2);
  });

  it('writes a timestamp in the register’s own format', () => {
    const db = register();
    db.exec("DELETE FROM clients WHERE id = 'c1'");
    // Say the number out loud, or a loop over no rows passes having checked
    // nothing — the vacuous test this suite has been bitten by before.
    expect(audit(db).length).toBe(2);
    for (const row of audit(db)) {
      expect(row.at!).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});
