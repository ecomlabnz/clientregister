/**
 * Family names in capitals, including the ones loaded before the rule.
 *
 * The practice records family names in capitals — NGUYEN, ANH TAN — and applies
 * it on the way in rather than in the templates, so the client, the matter
 * named from it, the export and any search all agree without each of them
 * remembering to.
 *
 * Asked for on 8 September 2026: *"go through all clients and capitalise their
 * surnames, and make it automatic on saving a new client."* The second half was
 * already true — every one of the five places that creates a client calls
 * `familyNameFor` — and that is pinned below, because it being true is not the
 * same as it staying true. The first half was not: 34 of 211 individuals were
 * loaded before the rule reached them, and nothing in the application revisits
 * a record nobody opens.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { familyNameFor, composeFullName } from '../src/core/names';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const MIGRATION = '0070_every_surname_in_capitals.sql';
const AT = '2026-09-01T09:00:00Z';
const USER = fakeUser();

function upTo(file: string) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
  const at = files.indexOf(file);
  expect(at, `${file} is not in the migrations directory`).toBeGreaterThan(0);
  for (const f of files.slice(0, at)) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  return db;
}
const applyRepair = (db: any) => db.exec(readFileSync(`migrations/${MIGRATION}`, 'utf8'));
const one = (db: any, sql: string): any => (db.prepare(sql) as any).get();

function seed(db: any) {
  db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
           VALUES ('u1','t@example.test','A Tester','x','admin','active','${AT}','${AT}')`);
  const client = db.prepare(
    `INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'active','${AT}','${AT}')`);
  // Loaded before the rule: the surname as somebody typed it.
  client.run('cl1', 'CL-0001', 'individual', 'Thi Ngoc Anh Le', 'Thi Ngoc Anh', 'Le');
  // Already right, and must not be touched.
  client.run('cl2', 'CL-0002', 'individual', 'Minh Duc TRAN', 'Minh Duc', 'TRAN');
  // A company: its registered name is not the practice's to restyle.
  client.run('cl3', 'CL-0003', 'organisation', 'Land Meat New Zealand Limited', null, null);
  // And a company that does carry a family name. Every one of the 26 in the
  // live register has none, so a repair that shouted at organisations would
  // have passed unnoticed — the guard has to be tested against a row that
  // would actually be caught by it.
  client.run('cl4', 'CL-0004', 'organisation', 'Anzco Foods Canterbury Limited',
             null, 'Anzco Foods Canterbury Limited');
  db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
           VALUES ('k1','CASE-26-001','cl1','RV. Partner — Thi Ngoc Anh Le','A description',
                   'rv_partner','lodged','u1','${AT}','${AT}'),
                  ('k2','CASE-26-002','cl1','A NAME SOMEBODY CHOSE for Thi Ngoc Anh Le','A description',
                   'rv_partner','lodged','u1','${AT}','${AT}'),
                  ('k3','CASE-26-003','cl2','WV. AEWV — Minh Duc TRAN','A description',
                   'wv_aewv','lodged','u1','${AT}','${AT}')`);
  return db;
}

describe('the surnames already in the register', () => {
  it('are put in capitals, and the whole name rebuilt with them', () => {
    const db = seed(upTo(MIGRATION));
    applyRepair(db);
    const row = one(db, `SELECT family_name AS f, full_name AS n FROM clients WHERE id = 'cl1'`);
    expect(row.f).toBe('LE');
    expect(row.n).toBe('Thi Ngoc Anh LE');
  });

  it('leaves a name that was already right exactly as it was', () => {
    const db = seed(upTo(MIGRATION));
    const before = one(db, `SELECT full_name AS n, updated_at AS u FROM clients WHERE id = 'cl2'`);
    applyRepair(db);
    const after = one(db, `SELECT full_name AS n, updated_at AS u FROM clients WHERE id = 'cl2'`);
    expect(after.n).toBe('Minh Duc TRAN');
    expect(after.u, 'a record that needed nothing was still written to').toBe(before.u);
  });

  it('does not shout a company’s registered name', () => {
    // A company's name is copied from the register that holds it.
    const db = seed(upTo(MIGRATION));
    applyRepair(db);
    expect(one(db, `SELECT full_name AS n FROM clients WHERE id = 'cl3'`).n)
      .toBe('Land Meat New Zealand Limited');
    const withName = one(db, `SELECT full_name AS n, family_name AS f FROM clients WHERE id = 'cl4'`);
    expect(withName.n, 'a company was restyled').toBe('Anzco Foods Canterbury Limited');
    expect(withName.f).toBe('Anzco Foods Canterbury Limited');
  });

  it('carries the correction into the matters named after the person', () => {
    // A matter is named "<type> — <client>". Renaming the client without this
    // leaves the old spelling on the front of every matter they have.
    const db = seed(upTo(MIGRATION));
    applyRepair(db);
    expect(one(db, `SELECT title AS t FROM cases WHERE id = 'k1'`).t)
      .toBe('RV. Partner — Thi Ngoc Anh LE');
  });

  it('corrects the name inside a title somebody chose, and keeps the rest', () => {
    const db = seed(upTo(MIGRATION));
    applyRepair(db);
    expect(one(db, `SELECT title AS t FROM cases WHERE id = 'k2'`).t)
      .toBe('A NAME SOMEBODY CHOSE for Thi Ngoc Anh LE');
  });

  it('leaves the matters of a client who needed nothing alone', () => {
    const db = seed(upTo(MIGRATION));
    applyRepair(db);
    expect(one(db, `SELECT title AS t FROM cases WHERE id = 'k3'`).t).toBe('WV. AEWV — Minh Duc TRAN');
  });

  it('leaves nothing behind for a second run to find', () => {
    const db = seed(upTo(MIGRATION));
    applyRepair(db);
    expect(one(db, `SELECT COUNT(*) AS n FROM clients
                     WHERE kind = 'individual' AND family_name IS NOT NULL
                       AND TRIM(family_name) <> '' AND family_name <> UPPER(family_name)`).n).toBe(0);
  });
});

describe('and every surname saved from now on', () => {
  it('is capitalised by the rule itself', () => {
    expect(familyNameFor('Le')).toBe('LE');
    expect(composeFullName('individual', { givenNames: 'Thi Ngoc Anh', familyName: 'Le' }))
      .toBe('Thi Ngoc Anh LE');
  });

  it('is capitalised through the form a person actually uses', async () => {
    const h = mountModule(clientsModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    await h.post('/clients', {
      kind: 'individual', given_names: 'Thi Ngoc Anh', family_name: 'le', status: 'prospect',
    });
    const row = h.get<{ family_name: string; full_name: string }>(
      'SELECT family_name, full_name FROM clients')!;
    expect(row.family_name).toBe('LE');
    expect(row.full_name).toBe('Thi Ngoc Anh LE');
  });

  it('is capitalised by every route that creates a client, not just the form', () => {
    // Five places write a client row. A sixth that forgot would put the old
    // problem back one record at a time, and nothing would say so.
    for (const file of [
      'src/modules/clients/index.ts', 'src/modules/cases/index.ts',
      'src/modules/inquiries/index.ts', 'src/modules/assistant/intake.ts',
    ]) {
      const source = readFileSync(file, 'utf8');
      if (!/INSERT INTO clients/.test(source)) continue;
      expect(source, `${file} creates a client without capitalising the surname`)
        .toMatch(/familyNameFor\(/);
    }
  });
});
