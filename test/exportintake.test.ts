import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { DATASETS } from '../src/modules/admin/export';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * The exports the intake prompt actually asks for.
 *
 * `docs/intake-prompt.md` tells the practice to export two lists before running
 * an extraction — the clients the register already holds, and the case-type
 * keys. Both were asked for and neither could be produced: the clients export
 * had no INZ client number, and there was no vocabulary export at all, so the
 * keys had to be copied out of a textarea by hand.
 *
 * A document telling somebody to press a button that does not exist is worse
 * than one that says nothing, so this holds the exports against the prompt.
 */

const AT = '2026-09-01T00:00:00Z';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, given_names, family_name,
                                   date_of_birth, status, created_at, updated_at)
              VALUES ('c1','CL-9001','individual','Chidi Amaka OKONKWO','Chidi Amaka','OKONKWO',
                      '1990-04-11','active',?,?)`).run(AT, AT);
  const matter = (id: string, ref: string, inz: string | null) =>
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   inz_client_number, created_at, updated_at)
                VALUES (?, ?, 'c1', 'A matter', 'wv_aewv', 'lodged', 'u1', ?, ?, ?)`)
      .run(id, ref, inz, AT, AT);
  return { db, matter };
}

const sqlFor = (key: string) => DATASETS.find((d) => d.key === key)!.sql;
const rows = (db: ReturnType<typeof register>['db'], sql: string) =>
  db.prepare(sql).all() as Array<Record<string, string | null>>;

describe('the clients export carries what the intake asks for', () => {
  it('names ref, family name, given names and date of birth', () => {
    const { db } = register();
    const columns = Object.keys(rows(db, sqlFor('clients'))[0]!);
    for (const c of ['ref', 'family_name', 'given_names', 'date_of_birth']) {
      expect(columns, `the intake asks for ${c}`).toContain(c);
    }
  });

  it('carries the INZ client number, taken from the person’s matters', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', '600123456');
    expect(rows(db, sqlFor('clients'))[0]!.inz_client_number).toBe('600123456');
  });

  it('says the number once for a person with two matters carrying it', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', '600123456');
    matter('k2', 'CASE-26-902', '600123456');
    expect(rows(db, sqlFor('clients'))[0]!.inz_client_number).toBe('600123456');
  });

  it('shows both when two matters disagree, rather than picking one', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', '600123456');
    matter('k2', 'CASE-26-902', '600999999');
    const got = rows(db, sqlFor('clients'))[0]!.inz_client_number!;
    expect(got.split(' ').sort()).toEqual(['600123456', '600999999']);
  });

  it('is blank, not empty-string noise, when no matter carries one', () => {
    const { db, matter } = register();
    matter('k1', 'CASE-26-901', null);
    matter('k2', 'CASE-26-902', '   ');
    expect(rows(db, sqlFor('clients'))[0]!.inz_client_number).toBe(null);
  });

  it('still keeps passport numbers out', () => {
    // The standing rule. An export lands in a downloads folder.
    const columns = Object.keys(rows(register().db, sqlFor('clients'))[0]!);
    expect(columns).not.toContain('passport_number');
    expect(columns).toContain('passport_on_file');
  });
});

describe('the vocabulary export gives the intake its case-type keys', () => {
  const seed = (db: ReturnType<typeof register>['db'], key: string, value: string) =>
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`)
      .run(key, value, AT);

  it('splits one stored list into a row per term', () => {
    const { db } = register();
    seed(db, 'vocab.case_types', 'wv_aewv | WV. AEWV\nvv_general | VV. General\not_other | Other');
    const got = rows(db, sqlFor('vocabulary'));
    expect(got.length).toBe(3);
    expect(got.map((r) => r.key).sort()).toEqual(['ot_other', 'vv_general', 'wv_aewv']);
    expect(got.find((r) => r.key === 'wv_aewv')!.label).toBe('WV. AEWV');
  });

  it('names which list each term belongs to', () => {
    const { db } = register();
    seed(db, 'vocab.case_types', 'wv_aewv | WV. AEWV');
    seed(db, 'vocab.visa_types', 'vv_visitor | Visitor visa');
    const got = rows(db, sqlFor('vocabulary'));
    expect(got.map((r) => r.list).sort()).toEqual(['case_types', 'visa_types']);
  });

  it('strips the carriage returns a textarea posts', () => {
    // CRLF is what the browser sends. A key ending in an invisible \r matches
    // nothing, and the person reading the CSV cannot see why.
    const { db } = register();
    seed(db, 'vocab.case_types', 'wv_aewv | WV. AEWV\r\nvv_general | VV. General\r\n');
    for (const r of rows(db, sqlFor('vocabulary'))) {
      expect(r.key, 'a key carries a carriage return').not.toMatch(/[\r\n]/);
      expect(r.label, 'a label carries a carriage return').not.toMatch(/[\r\n]/);
    }
  });

  it('ignores blank lines rather than exporting empty terms', () => {
    const { db } = register();
    seed(db, 'vocab.case_types', 'wv_aewv | WV. AEWV\n\n\nvv_general | VV. General\n   \n');
    expect(rows(db, sqlFor('vocabulary')).length).toBe(2);
  });

  it('reads the last term even without a trailing newline', () => {
    // The splitter walks to the next newline, so a list that does not end in
    // one loses its final term — which would be the most recently added type.
    const { db } = register();
    seed(db, 'vocab.case_types', 'wv_aewv | WV. AEWV\nzz_newest | The one just added');
    expect(rows(db, sqlFor('vocabulary')).map((r) => r.key)).toContain('zz_newest');
  });

  it('counts as a subquery, which the export page needs to show a row count', () => {
    const { db } = register();
    seed(db, 'vocab.case_types', 'wv_aewv | WV. AEWV\nvv_general | VV. General');
    const [row] = db.prepare(`SELECT COUNT(*) AS n FROM (${sqlFor('vocabulary')})`).all() as Array<{ n: number }>;
    const n = row!.n;
    expect(n).toBe(2);
  });
});

describe('every dataset the export page offers', () => {
  it('runs, and can be counted', () => {
    const { db } = register();
    expect(DATASETS.length).toBeGreaterThan(10);
    for (const set of DATASETS) {
      expect(() => db.prepare(`SELECT COUNT(*) AS n FROM (${set.sql})`).all(),
             `${set.key} does not run`).not.toThrow();
    }
  });
});
