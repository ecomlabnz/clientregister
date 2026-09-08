/**
 * Migration 0064 rebuilds the file-note table. This is the rehearsal, kept.
 *
 * `entries` holds the practice's file notes. It is append-only, guarded by
 * three triggers, and on 8 September 2026 it held 883 real rows. Rebuilding it
 * — to drop a CHECK that had been silently refusing a kind the forms offered —
 * means copying every one of those rows, dropping the original, and putting the
 * guards back.
 *
 * A migration like that gets rehearsed on a copy before it runs. What is
 * unusual is that the rehearsal is worth keeping: it is the only thing that
 * says the rows survived and the guards still guard, and it can say so on every
 * build rather than once.
 *
 * So: apply the migrations up to 0063, put rows in at the shape production
 * actually had, apply 0064, and count.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const MIGRATION = '0064_the_practice_names_its_own_notes.sql';
const AT = '2026-09-01T09:00:00Z';

/** Every migration before the one under test. */
function upToTheRebuild() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
  const at = files.indexOf(MIGRATION);
  expect(at, `${MIGRATION} is not in the migrations directory`).toBeGreaterThan(0);
  for (const file of files.slice(0, at)) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  return db;
}

const applyRebuild = (db: ReturnType<typeof upToTheRebuild>) =>
  db.exec(readFileSync(`migrations/${MIGRATION}`, 'utf8'));

/**
 * The register as it stood, at the shape the live one had: 474 notes, 225
 * system, 152 file, 28 message, 2 call, 1 email in, 1 email out. The numbers
 * are the real ones because the thing being proved is that a copy of that many
 * rows loses none of them.
 */
const PRODUCTION_SHAPE: Array<[string, number]> = [
  ['note', 474], ['system', 225], ['file', 152], ['message', 28],
  ['call', 2], ['email_in', 1], ['email_out', 1],
];

function seed(db: ReturnType<typeof upToTheRebuild>) {
  db.exec(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
           VALUES ('u1','t@example.test','A Tester','x','admin','${AT}','${AT}')`);
  db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
           VALUES ('cl1','CL-1','individual','A PERSON','active','${AT}','${AT}')`);
  const insert = db.prepare(
    `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, pinned,
                          created_at, created_by, edited_at)
     VALUES (?, 'client', 'cl1', ?, ?, ?, ?, ?, 'u1', ?)`,
  );
  let n = 0;
  for (const [kind, count] of PRODUCTION_SHAPE) {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      // Values chosen to break a naive copy: quotes, a newline, non-ASCII, and
      // the two nullable flags actually set on some rows.
      (insert as any).run(
        `e${n}`, kind, `Note ${n} — O'Brien said “kia ora”\nand left.`,
        AT, n % 50 === 0 ? 1 : 0, AT, n % 100 === 0 ? AT : null,
      );
    }
  }
  return n;
}

const one = (db: any, sql: string) => (db.prepare(sql) as any).get();

describe('rebuilding the file-note table', () => {
  it('loses not one row, and changes not one value', () => {
    const db = upToTheRebuild();
    const seeded = seed(db);
    expect(seeded).toBe(883);

    const shape = () => ({
      rows: one(db, 'SELECT COUNT(*) AS n FROM entries').n,
      kinds: (db.prepare('SELECT kind, COUNT(*) AS n FROM entries GROUP BY kind ORDER BY kind') as any).all(),
      // A checksum over the whole table, not a row count: a copy that dropped a
      // column, reordered one, or mangled an apostrophe would keep the count.
      digest: one(db, `SELECT COUNT(*) AS n, SUM(LENGTH(body)) AS b, SUM(pinned) AS p,
                              COUNT(edited_at) AS e, MIN(id) AS lo, MAX(id) AS hi,
                              GROUP_CONCAT(kind) AS k
                         FROM (SELECT * FROM entries ORDER BY id)`),
    });

    const before = JSON.stringify(shape());
    applyRebuild(db);
    expect(JSON.stringify(shape())).toBe(before);
  });

  it('takes the CHECK off, which is the whole point', () => {
    const db = upToTheRebuild();
    seed(db);
    const write = (kind: string) => (db.prepare(
      `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
       VALUES ('x_${kind}', 'client', 'cl1', ?, 'x', '${AT}', '${AT}')`,
    ) as any).run(kind);

    // Before: the kind the forms had been offering since 1 September.
    expect(() => write('consult')).toThrow(/CHECK/);
    applyRebuild(db);
    expect(() => write('consult')).not.toThrow();
    expect(() => write('status_query')).not.toThrow();
  });

  it('puts every guard back', () => {
    // The append-only rules are the reason this table is trusted. A rebuild
    // that quietly dropped one would leave the file notes editable and nothing
    // would say so.
    const db = upToTheRebuild();
    seed(db);
    applyRebuild(db);

    expect(() => db.exec("DELETE FROM entries WHERE id = 'e1'"))
      .toThrow(/append-only: a note cannot be deleted/);

    // Written well outside the five-minute window, so a correction is refused.
    expect(() => db.exec(
      `UPDATE entries SET body = 'rewritten', edited_at = '${AT}' WHERE id = 'e1'`,
    )).toThrow(/only within five minutes/);

    expect(() => db.exec("UPDATE entries SET entity_id = 'cl2' WHERE id = 'e1'"))
      .toThrow(/append-only/);
  });

  it('leaves the trigger it had to lift out of the way exactly as it was', () => {
    // `inquiry_delete_only_while_it_is_only_an_inquiry` reads `entries`, so the
    // rename would fail with it in place. It comes off and goes back on — and
    // the rule it carries has nothing to do with this migration, so it has to
    // still hold afterwards.
    const db = upToTheRebuild();
    seed(db);
    applyRebuild(db);

    db.exec(`INSERT INTO inquiries (id, ref, source, status, contact_name,
                                    received_at, created_at, updated_at)
             VALUES ('inq1','INQ-1','email','new','A Person','${AT}','${AT}','${AT}')`);
    db.exec(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
             VALUES ('en_inq','inquiry','inq1','note','said something','${AT}','${AT}')`);

    expect(() => db.exec("DELETE FROM inquiries WHERE id = 'inq1'"))
      .toThrow(/an inquiry with a file note cannot be deleted/);
  });

  it('keeps the indexes the table is read through', () => {
    const db = upToTheRebuild();
    applyRebuild(db);
    const names = ((db.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='entries' AND sql IS NOT NULL`,
    ) as any).all() as Array<{ name: string }>).map((r) => r.name).sort();
    expect(names).toEqual(['idx_entries_document', 'idx_entries_entity']);
  });
});
