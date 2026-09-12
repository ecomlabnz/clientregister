/**
 * A value from one of the practice's lists has to be on the list.
 *
 * **Found on 12 September 2026.** 35 client records in the live register held
 * the *label* of a visa or an English test instead of its key, from a bulk
 * import on 1 September. Nothing displayed wrong; the dropdown rendered blank,
 * and saving one would have erased the client's visa type without a word. Then
 * the worse finding: **no path validated** — not the client form, not the
 * intake assistant, not the AI reader, not an import, not the D1 console.
 *
 * Migration 0101 moves the check into the database, where every one of those
 * paths crosses. This file attacks the database **directly** — statements fired
 * at SQLite with the migrations applied, never through a route — because that
 * is the only way to test a guarantee that is supposed to hold whoever is
 * writing.
 *
 * Four things are proved here and each one is a decision that could have gone
 * the other way:
 *
 *  1. **Only when the value changes.** An administrator who removes a term must
 *     not strand the records already filed under it.
 *  2. **Empty and NULL always pass.** "Not recorded" is a legitimate state.
 *  3. **A list the database cannot find allows everything.** The failure is
 *     permissive; the other way round locks a register solid.
 *  4. **Every trigger is mutation-tested.** Each is removed, the write it was
 *     supposed to refuse is fired again, and its absence has to be visible.
 *
 * No client of the practice appears here. The bad values are the *shapes* that
 * arrived — a label where a key belongs — with invented specifics.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fakeUser, migratedSqlite, mountModule } from './support/d1';
import { parseVocabulary, VOCABULARIES } from '../src/core/vocabulary';
import { adminModule } from '../src/modules/admin';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-12T09:00:00Z';
const GUARD = '0101_a_value_from_a_list_has_to_be_on_the_list.sql';

/**
 * Every guarded column, the list behind it, a value that is on that list and a
 * value of the shape that actually arrived in the import.
 *
 * This table is the specification. A column added to the migration and not to
 * this list fails the count assertion at the bottom.
 */
const GUARDED: Array<{ table: string; column: string; list: string; good: string; bad: string }> = [
  { table: 'clients', column: 'current_visa_type', list: 'vocab.visa_types', good: 'wv_aewv', bad: 'Work Visa - Accredited Employer Work Visa' },
  { table: 'clients', column: 'english_test_type', list: 'vocab.english_tests', good: 'ielts', bad: 'IELTS (General)' },
  { table: 'clients', column: 'title', list: 'vocab.titles', good: 'mr', bad: 'Mister' },
  { table: 'clients', column: 'gender', list: 'vocab.genders', good: 'male', bad: 'M' },
  { table: 'clients', column: 'relationship_status', list: 'vocab.relationship_statuses', good: 'married', bad: 'Married (de facto)' },
  { table: 'cases', column: 'case_type', list: 'vocab.case_types', good: 'wv_aewv', bad: 'Work Visa' },
  { table: 'quotes', column: 'case_type', list: 'vocab.case_types', good: 'wv_aewv', bad: 'Work Visa' },
  { table: 'quote_items', column: 'case_type', list: 'vocab.case_types', good: 'wv_aewv', bad: 'Work Visa' },
  { table: 'documents', column: 'category', list: 'vocab.doc_categories', good: 'identity', bad: 'Identity documents' },
  { table: 'flags', column: 'kind', list: 'vocab.flag_kinds', good: 'safety', bad: 'General' },
  { table: 'entries', column: 'kind', list: 'vocab.note_kinds', good: 'call', bad: 'Phone Call' },
  { table: 'client_employment', column: 'kind', list: 'vocab.employment_kinds', good: 'employed', bad: 'employee' },
  { table: 'client_education', column: 'level', list: 'vocab.education_levels', good: 'nzqcf_7', bad: "Bachelor's degree" },
  { table: 'client_education', column: 'completed', list: 'vocab.education_outcomes', good: 'completed', bad: 'Yes' },
  { table: 'client_travel', column: 'purpose', list: 'vocab.travel_purposes', good: 'family', bad: 'Family visit' },
  { table: 'client_travel', column: 'mode', list: 'vocab.travel_modes', good: 'air', bad: 'Aeroplane' },
];

/** The columns the schema itself insists on; a NULL there is not this guard. */
const NOT_NULL = new Set([
  'cases.case_type', 'documents.category', 'flags.kind', 'entries.kind', 'client_employment.kind',
]);

type Db = ReturnType<typeof migratedSqlite>;

function register(): Db {
  const db = migratedSqlite();
  db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
           VALUES ('u1','a@example.test','An Adviser','x','adviser','active','${AT}','${AT}')`);
  db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
           VALUES ('cl1','CL-0001','individual','A Person','active','${AT}','${AT}')`);
  db.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,created_at,updated_at)
           VALUES ('qu1','QU-0001','cl1','Work',100,'${AT}','${AT}')`);
  return db;
}

let seq = 0;

/** Insert one row into `table` with `column` set to `value`, directly. */
function insert(db: Db, table: string, column: string, value: string | null): string {
  const id = `g${++seq}`;
  // A file note may only be corrected inside a five-minute window measured by
  // the database's own clock, so its `created_at` has to be genuinely now.
  const now = new Date().toISOString();
  const rows: Record<string, Record<string, unknown>> = {
    clients: { id, ref: `CL-${id}`, kind: 'individual', full_name: 'A Person', status: 'active', created_at: AT, updated_at: AT },
    cases: { id, ref: `CA-${id}`, client_id: 'cl1', title: 'A matter', case_type: 'wv_aewv', status: 'open', assigned_to: 'u1', created_at: AT, updated_at: AT },
    quotes: { id, ref: `QU-${id}`, client_id: 'cl1', description: 'Work', amount_cents: 1, created_at: AT, updated_at: AT },
    quote_items: { id, quote_id: 'qu1', description: 'Work', unit_amount_cents: 1, net_cents: 1, gst_cents: 0, gross_cents: 1, created_at: AT, updated_at: AT },
    documents: { id, entity_type: 'client', entity_id: 'cl1', r2_key: `k/${id}`, filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 1, uploaded_at: AT },
    flags: { id, entity_type: 'client', entity_id: 'cl1', kind: 'safety', body: 'Something', raised_at: AT, updated_at: AT },
    entries: { id, entity_type: 'client', entity_id: 'cl1', kind: 'note', body: 'Something', occurred_at: AT, created_at: now },
    client_employment: { id, client_id: 'cl1', kind: 'employed', created_at: AT, updated_at: AT },
    client_education: { id, client_id: 'cl1', created_at: AT, updated_at: AT },
    client_travel: { id, client_id: 'cl1', created_at: AT, updated_at: AT },
  };
  const row = { ...rows[table]!, [column]: value };
  const names = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
    .run(...names.map((n) => row[n] as never));
  return id;
}

/** Change `column` on one row, directly. */
function update(db: Db, table: string, column: string, id: string, value: string | null): void {
  // A correction to a note has to say it is one; that is 0076's rule, not this
  // guard's, and it would otherwise mask what is being tested here.
  const extra = table === 'entries' ? `, edited_at = '${new Date().toISOString()}'` : '';
  db.prepare(`UPDATE ${table} SET ${column} = ?${extra} WHERE id = ?`).run(value as never, id);
}

describe('the database refuses a value that is not on its list', () => {
  for (const { table, column, list, good, bad } of GUARDED) {
    it(`${table}.${column} refuses a value that is not in ${list}`, () => {
      const db = register();
      expect(() => insert(db, table, column, bad))
        .toThrow(`${table}.${column} is not on the practice's list of`);
    });

    it(`${table}.${column} accepts a key that is`, () => {
      const db = register();
      expect(() => insert(db, table, column, good)).not.toThrow();
    });

    it(`${table}.${column} refuses it on update too`, () => {
      const db = register();
      const id = insert(db, table, column, good);
      expect(() => update(db, table, column, id, bad))
        .toThrow(`${table}.${column} is not on the practice's list of`);
    });

    it(`${table}.${column} allows empty and, where the column permits it, NULL`, () => {
      const db = register();
      expect(() => insert(db, table, column, '')).not.toThrow();
      if (!NOT_NULL.has(`${table}.${column}`)) {
        expect(() => insert(db, table, column, null)).not.toThrow();
      }
    });

    it(`${table}.${column} treats whitespace as a blank, not as a value`, () => {
      // `test/alertsql.test.ts` has held a client whose visa type is three
      // spaces since the alerts were written. A blank typed as spaces is still
      // a blank; refusing it would be a rule about typing.
      const db = register();
      expect(() => insert(db, table, column, '   ')).not.toThrow();
      expect(() => insert(db, table, column, '\t\n')).not.toThrow();
    });
  }
});

describe('removing a term from a list strands nothing', () => {
  it('a row already holding a retired term still saves, and saves unchanged', () => {
    const db = register();
    const id = insert(db, 'clients', 'current_visa_type', 'wv_aewv');
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                VALUES ('vocab.visa_types', 'vv_visitor | VV. Visitor', ?, 'u1')`).run(AT);

    // Gone from the list, so nobody may choose it afresh.
    expect(() => insert(db, 'clients', 'current_visa_type', 'wv_aewv'))
      .toThrow("clients.current_visa_type is not on the practice's list of");

    // The record that already carries it is untouched, and still editable.
    expect(() => db.prepare(`UPDATE clients SET full_name = ? WHERE id = ?`).run('A Renamed Person', id))
      .not.toThrow();
    // Including a save that writes the column back to what it already held,
    // which is what every form does: it posts every field.
    expect(() => update(db, 'clients', 'current_visa_type', id, 'wv_aewv')).not.toThrow();
    // And it may always be cleared.
    expect(() => update(db, 'clients', 'current_visa_type', id, null)).not.toThrow();
  });

  it('a value the practice adds becomes writable at once', () => {
    const db = register();
    expect(() => insert(db, 'clients', 'current_visa_type', 'rv_special'))
      .toThrow("clients.current_visa_type is not on the practice's list of");

    const { terms } = db.prepare(
      `SELECT terms FROM vocabulary_defaults WHERE setting_key = 'vocab.visa_types'`).get() as { terms: string };
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('vocab.visa_types', ?, ?, 'u1')`)
      .run(`${terms}\nrv_special | RV. A special one`, AT);

    expect(() => insert(db, 'clients', 'current_visa_type', 'rv_special')).not.toThrow();
  });

  it('and it stops being writable again when they take it away', () => {
    const db = register();
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                VALUES ('vocab.titles', 'mr | Mr', ?, 'u1')`).run(AT);
    expect(() => insert(db, 'clients', 'title', 'dr'))
      .toThrow("clients.title is not on the practice's list of");
    db.exec(`DELETE FROM settings WHERE key = 'vocab.titles'`);
    // Deleting the row hands the list back to the register's default, which has
    // Dr on it — the same order `vocabulary()` uses in the code.
    expect(() => insert(db, 'clients', 'title', 'dr')).not.toThrow();
  });
});

describe('what the database does when it cannot find a list', () => {
  it('falls back to the register default when the practice has saved nothing', () => {
    const db = register();
    expect(db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'vocab.%'`).get())
      .toEqual({ n: 0 });
    expect(() => insert(db, 'clients', 'current_visa_type', 'wv_aewv')).not.toThrow();
    expect(() => insert(db, 'clients', 'current_visa_type', 'nonsense'))
      .toThrow("clients.current_visa_type is not on the practice's list of");
  });

  it('falls back to the default when the saved list parses to nothing at all', () => {
    const db = register();
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                VALUES ('vocab.visa_types', ?, ?, 'u1')`).run('# everything commented out\n\n   \n', AT);
    expect(() => insert(db, 'clients', 'current_visa_type', 'wv_aewv')).not.toThrow();
  });

  it('allows anything when no list can be found at all — it never refuses everything', () => {
    const db = register();
    db.exec(`DELETE FROM vocabulary_defaults WHERE setting_key = 'vocab.visa_types'`);
    expect(() => insert(db, 'clients', 'current_visa_type', 'whatever you like')).not.toThrow();
  });

  it('a register with no lists at all is still a register somebody can type into', () => {
    const db = register();
    db.exec('DELETE FROM vocabulary_defaults');
    for (const { table, column, bad } of GUARDED) {
      expect(() => insert(db, table, column, bad)).not.toThrow();
    }
  });
});

describe('every guard trigger, mutation-tested', () => {
  it('each one is what refuses, and its absence is visible', () => {
    const db = register();
    const names = (db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%\\_is\\_on\\_its\\_list\\_%' ESCAPE '\\'
        ORDER BY name`).all() as Array<{ name: string; sql: string }>);
    expect(names).toHaveLength(GUARDED.length * 2);

    for (const { table, column, good, bad } of GUARDED) {
      for (const when of ['insert', 'update'] as const) {
        const name = `${table}_${column}_is_on_its_list_${when}`;
        const sql = names.find((t) => t.name === name)?.sql;
        expect(sql, `${name} exists`).toBeTruthy();

        const fire = when === 'insert'
          ? () => { insert(db, table, column, bad); }
          : () => { update(db, table, column, insert(db, table, column, good), bad); };

        expect(fire, `${name} refuses`).toThrow(`${table}.${column} is not on the practice's list of`);
        db.exec(`DROP TRIGGER ${name}`);
        expect(fire, `${name} removed: the bad write lands`).not.toThrow();
        db.exec(sql!);
        expect(fire, `${name} restored: refuses again`).toThrow(`${table}.${column} is not on the practice's list of`);
      }
    }
  });
});

describe('the register writes four kinds of note about itself', () => {
  // `system`, `email_in` and `email_out` are not the practice's words and never
  // appear in their list; `note` is what every note form falls back to when a
  // submitted kind is not on the list, so refusing it would make notes
  // unwritable for anybody who took "Note" off their list.
  for (const kind of ['system', 'email_in', 'email_out', 'note']) {
    it(`entries.kind accepts ${kind} whatever the list says`, () => {
      const db = register();
      db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                  VALUES ('vocab.note_kinds', 'meeting | Meeting', ?, 'u1')`).run(AT);
      expect(() => insert(db, 'entries', 'kind', kind)).not.toThrow();
    });
  }
});

describe('the database keeps the register defaults, and they are the code’s', () => {
  it('holds a row for every vocabulary', () => {
    const rows = db0().prepare(`SELECT setting_key FROM vocabulary_defaults ORDER BY setting_key`).all() as Array<{ setting_key: string }>;
    expect(rows.map((r) => r.setting_key).sort())
      .toEqual(VOCABULARIES.map((v) => v.key).sort());
  });

  it('holds the same keys the code declares — this is what stops the two drifting', () => {
    const db = db0();
    for (const vocab of VOCABULARIES) {
      const row = db.prepare(`SELECT terms FROM vocabulary_defaults WHERE setting_key = ?`)
        .get(vocab.key) as { terms: string };
      expect(parseVocabulary(row.terms).map((t) => t.key), vocab.key)
        .toEqual(parseVocabulary(vocab.defaults).map((t) => t.key));
    }
  });

  it('parses each one to the same keys the code does, letters and digits only', () => {
    const db = db0();
    for (const vocab of VOCABULARIES) {
      const stored = (db.prepare(`SELECT term_key FROM vocabulary_terms WHERE setting_key = ? ORDER BY term_key`)
        .all(vocab.key) as Array<{ term_key: string }>).map((r) => r.term_key);
      const fromCode = parseVocabulary(vocab.defaults)
        .map((t) => t.key.replace(/[^a-z0-9]/g, '')).sort();
      expect(stored, vocab.key).toEqual(fromCode);
    }
  });

  it('the kept answer and the parse it came from never come apart', () => {
    const db = register();
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                VALUES ('vocab.flag_kinds', ?, ?, 'u1')`).run('safety | Safety\nborder | Border', AT);
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                VALUES ('vocab.titles', ?, ?, 'u1')`).run('mr | Mr', AT);
    db.exec(`UPDATE settings SET value = 'mr | Mr\nsir | Sir' WHERE key = 'vocab.titles'`);
    db.exec(`DELETE FROM settings WHERE key = 'vocab.flag_kinds'`);

    const kept = db.prepare(`SELECT setting_key, term_key FROM vocabulary_terms ORDER BY 1, 2`).all();
    const parsed = db.prepare(`SELECT setting_key, term_key FROM vocabulary_effective ORDER BY 1, 2`).all();
    expect(kept).toEqual(parsed);
  });

  let cached: Db | null = null;
  function db0(): Db { return (cached ??= migratedSqlite()); }
});

describe('a list saved from a browser, with the line endings a browser sends', () => {
  it('CRLF does not break the parse', () => {
    // The practice's own `vocab.education_levels` is stored with CRLF endings,
    // which is how issue 15 established it came from a textarea rather than a
    // seed. A parse that split on newlines alone would leave a carriage return
    // on the end of every key and match nothing.
    const db = register();
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                VALUES ('vocab.genders', ?, ?, 'u1')`).run('male | Male\r\nfemale | Female\r\n', AT);
    expect(() => insert(db, 'clients', 'gender', 'female')).not.toThrow();
    expect(() => insert(db, 'clients', 'gender', 'gender_diverse'))
      .toThrow("clients.gender is not on the practice's list of");
  });

  it('a line the parser would drop is dropped here too', () => {
    const db = register();
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by)
                VALUES ('vocab.travel_modes', ?, ?, 'u1')`)
      .run('# air is deliberately commented out\n# air | Air\nsea | Sea\n\n   \nland | Land', AT);
    expect(() => insert(db, 'client_travel', 'mode', 'sea')).not.toThrow();
    expect(() => insert(db, 'client_travel', 'mode', 'air'))
      .toThrow("client_travel.mode is not on the practice's list of");
  });
});

/**
 * The rehearsal: migration 0101 applied to a register shaped like the live one,
 * with the 35 bad rows still in it.
 *
 * The shapes are the live register's; the names are invented. What has to be
 * true afterwards is that **not one row changed** — this migration adds a rule,
 * it does not rewrite anybody's file — and that the register is still workable.
 */
describe('the migration, rehearsed against the shapes the live register holds', () => {
  const BAD_VISA = 'Work Visa - Accredited Employer Work Visa';

  /** Every migration except the guard, then a register with work in it. */
  function before(): Db {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
      if (file === GUARD) continue;
      db.exec(readFileSync(`migrations/${file}`, 'utf8'));
    }
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@example.test','An Adviser','x','adviser','active','${AT}','${AT}')`);

    // The practice's own register carries two real customisations and CRLF
    // endings, and pressing Save once stores all fourteen lists (issue 15).
    db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?,?,?,?)`)
      .run('vocab.doc_categories',
        'identity | Identity\r\nhealth | Health\r\nppi_letter | PPI Letter\r\n'
        + 'rfi_letter | RFI Letter\r\nvisa | Visa\r\nother | Other\r\n', AT, 'u1');

    const add = db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,
                                                 current_visa_type,english_test_type,created_at,updated_at)
                            VALUES (?,?,'individual',?,'active',?,?,?,?)`);
    const fine = ['wv_aewv', 'rv_resident', 'sv_student', 'vv_visitor', 'other_interim'];
    for (let i = 0; i < 200; i++) {
      add.run(`c${i}`, `CL-${1000 + i}`, `Person ${i}`,
        i < 35 ? BAD_VISA : fine[i % 5]!, i < 12 ? 'IELTS (General)' : 'ielts', AT, AT);
    }
    db.prepare(`INSERT INTO documents (id,entity_type,entity_id,r2_key,filename,content_type,size_bytes,category,uploaded_at)
                VALUES ('d1','client','c0','k/1','a.pdf','application/pdf',1,'ppi_letter',?)`).run(AT);
    return db;
  }

  function apply(db: Db): void {
    db.exec(readFileSync(`migrations/${GUARD}`, 'utf8'));
  }

  it('changes not one row', () => {
    const db = before();
    const snap = () => JSON.stringify(db.prepare(
      `SELECT id, current_visa_type, english_test_type FROM clients ORDER BY id`).all());
    const was = snap();
    apply(db);
    expect(snap()).toBe(was);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM clients`).get()).toEqual({ n: 200 });
  });

  it('reports exactly what is wrong, and nothing that is not', () => {
    const db = before();
    apply(db);
    expect(db.prepare(`SELECT table_name, column_name, value, rows_affected
                         FROM vocabulary_mismatches ORDER BY rows_affected DESC`).all())
      .toEqual([
        { table_name: 'clients', column_name: 'current_visa_type', value: BAD_VISA, rows_affected: 35 },
        { table_name: 'clients', column_name: 'english_test_type', value: 'IELTS (General)', rows_affected: 12 },
      ]);
  });

  it('leaves every one of the 35 records saveable', () => {
    const db = before();
    apply(db);
    // What an adviser actually does: open the file, change something else, save.
    // The form posts every field, so the visa type is written back as it stands.
    expect(() => db.prepare(`UPDATE clients SET full_name = ?, current_visa_type = ? WHERE id = 'c0'`)
      .run('Person Nought', BAD_VISA)).not.toThrow();
    expect(db.prepare(`SELECT current_visa_type AS v FROM clients WHERE id = 'c0'`).get())
      .toEqual({ v: BAD_VISA });
  });

  it('refuses the same bad value on a record made after it', () => {
    const db = before();
    apply(db);
    expect(() => db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,current_visa_type,created_at,updated_at)
                             VALUES ('cx','CL-9999','individual','New Person','active',?,?,?)`)
      .run(BAD_VISA, AT, AT))
      .toThrow("clients.current_visa_type is not on the practice's list of");
  });

  it('honours the practice’s own customised list, and only theirs', () => {
    const db = before();
    apply(db);
    const has = (k: string) => db.prepare(
      `SELECT COUNT(*) AS n FROM vocabulary_terms WHERE setting_key='vocab.doc_categories' AND term_key=?`)
      .get(k) as { n: number };
    expect(has('ppiletter')).toEqual({ n: 1 });   // theirs
    expect(has('engagement')).toEqual({ n: 0 });  // the register's, which they replaced
    // And a file already filed under one of their headings is untouched.
    expect(() => db.exec(`UPDATE documents SET filename = 'renamed.pdf' WHERE id = 'd1'`)).not.toThrow();
  });
});

describe('the self-check reports and never fixes', () => {
  it('is a view, so nothing can write through it', () => {
    const db = register();
    const row = db.prepare(`SELECT type FROM sqlite_master WHERE name = 'vocabulary_mismatches'`).get();
    expect(row).toEqual({ type: 'view' });
    expect(() => db.exec(`DELETE FROM vocabulary_mismatches`)).toThrow();
  });

  it('is silent on a register whose values are all on their lists', () => {
    const db = register();
    for (const { table, column, good } of GUARDED) insert(db, table, column, good);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM vocabulary_mismatches`).get()).toEqual({ n: 0 });
  });

  it('names the column, the list, the value and how many rows carry it', () => {
    const db = register();
    // Put two bad rows in the way an import does: with the guard out of the way.
    db.exec(`DROP TRIGGER clients_title_is_on_its_list_insert`);
    insert(db, 'clients', 'title', 'Mister');
    insert(db, 'clients', 'title', 'Mister');
    insert(db, 'clients', 'title', 'Madam');

    expect(db.prepare(`SELECT table_name, column_name, setting_key, value, rows_affected
                         FROM vocabulary_mismatches ORDER BY rows_affected DESC, value`).all())
      .toEqual([
        { table_name: 'clients', column_name: 'title', setting_key: 'vocab.titles', value: 'Mister', rows_affected: 2 },
        { table_name: 'clients', column_name: 'title', setting_key: 'vocab.titles', value: 'Madam', rows_affected: 1 },
      ]);
  });

  it('covers every guarded column and no other', () => {
    const db = migratedSqlite();
    const sql = (db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'vocabulary_mismatches'`)
      .get() as { sql: string }).sql;
    for (const { table, column } of GUARDED) {
      expect(sql, `${table}.${column} is in the self-check`)
        .toContain(`'${table}' AS table_name, '${column}' AS column_name`);
    }
    expect(sql.match(/AS table_name/g)).toHaveLength(GUARDED.length);
  });

  it('says nothing about a list it cannot find', () => {
    const db = register();
    db.exec(`DROP TRIGGER clients_title_is_on_its_list_insert`);
    insert(db, 'clients', 'title', 'Mister');
    expect(db.prepare(`SELECT COUNT(*) AS n FROM vocabulary_mismatches`).get()).toEqual({ n: 1 });
    db.exec(`DELETE FROM vocabulary_defaults WHERE setting_key = 'vocab.titles'`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM vocabulary_mismatches`).get()).toEqual({ n: 0 });
  });
});

describe('the self-check page', () => {
  const admin = () => {
    const h = mountModule(adminModule, { user: fakeUser({ role: 'owner' }) });
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('cl1','CL-0001','individual','A Person','active','${AT}','${AT}')`);
    return h;
  };

  it('says so plainly when there is nothing wrong', async () => {
    const h = admin();
    const body = await (await h.request('/admin/self-check')).text();
    expect(body).toContain('Nothing out of place');
    expect(body).toContain('Checked against 14 lists');
  });

  it('names the field, the value, the count and the list to fix it on', async () => {
    const h = admin();
    // Two records carrying a label, put there the way the import did — with the
    // guard out of the way, as it was before migration 0101.
    h.db.exec(`DROP TRIGGER clients_current_visa_type_is_on_its_list_insert`);
    for (const id of ['c1', 'c2']) {
      h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,current_visa_type,created_at,updated_at)
                 VALUES ('${id}','CL-${id}','individual','P','active',
                         'Work Visa - Accredited Employer Work Visa','${AT}','${AT}')`);
    }
    const body = await (await h.request('/admin/self-check')).text();
    expect(body, 'what the field is, in words').toContain('The visa a client holds now');
    expect(body, 'the value as stored').toContain('Work Visa - Accredited Employer Work Visa');
    expect(body, 'the list it should be on').toContain('Visa a client currently holds');
    expect(body, 'how many records carry it').toMatch(/>\s*2\s/);
    expect(body, 'where to put it right').toContain('/admin/settings?tab=vocabulary');
    expect(body).not.toContain('Nothing out of place');
  });

  it('has no form on it, because it reports and never fixes', async () => {
    const h = admin();
    h.db.exec(`DROP TRIGGER clients_title_is_on_its_list_insert`);
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,title,created_at,updated_at)
               VALUES ('c1','CL-c1','individual','P','active','Mister','${AT}','${AT}')`);
    const body = await (await h.request('/admin/self-check')).text();
    expect(body, 'it reports the value').toContain('Mister');
    // Nothing on the page posts anywhere, and there is nothing to post to.
    expect(body).not.toMatch(/<form[^>]*action="\/admin\/self-check/);
    expect((await h.post('/admin/self-check')).status, 'no write route exists').toBe(404);
  });

  it('is behind the settings permission, like the rest of Settings', async () => {
    const h = mountModule(adminModule, { user: fakeUser({ role: 'readonly' }) });
    expect((await h.request('/admin/self-check')).status).toBe(403);
  });

  it('says when a list is not being checked against at all', async () => {
    const h = admin();
    h.db.exec(`DELETE FROM vocabulary_defaults WHERE setting_key = 'vocab.titles'`);
    const body = await (await h.request('/admin/self-check')).text();
    expect(body).toContain('Lists nothing is being checked against');
    expect(body).toContain('Titles');
  });
});

describe('every vocabulary in the code is guarded somewhere', () => {
  it('leaves none of the fourteen lists unenforced', () => {
    const guardedLists = new Set(GUARDED.map((g) => g.list));
    const declared = VOCABULARIES.map((v) => v.key);
    expect([...declared].filter((k) => !guardedLists.has(k))).toEqual([]);
  });
});
