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
import { familyNameFor, givenNamesFor, composeFullName, formalName } from '../src/core/names';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { assistantModule } from '../src/modules/assistant';
import { normaliseClientName } from '../src/core/casename';

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

/**
 * The record the assistant merely reuses.
 *
 * Reported on 8 September 2026: *"case CASE-26-210 was just created through the
 * assistant and the surname was not capitalised, I did it manually."*
 *
 * The assistant had not failed to capitalise anything. It had matched an
 * existing client — correctly — and used it as it stood, and that record had
 * been loaded on 1 September before the rule reached it. Migration 0070 has
 * since corrected all 34 of those, so that particular record is fixed.
 *
 * The hole it came through is not fixed by a migration: the register never
 * tidied a record it merely reused. Another load, another import, a row written
 * by hand, and the same thing happens — and the matter named from that record
 * carries the old spelling into every list in the app.
 */
describe('a client record the assistant reuses', () => {
  const TYPES = [{ key: 'wv_aewv', label: 'WV. AEWV' }];

  function withOldRecord() {
    const h = mountModule(assistantModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.exec(`INSERT INTO settings (key,value,updated_at)
               VALUES ('vocab.case_types','wv_aewv | WV. AEWV','${AT}')`);
    // Loaded before the rule: the surname as somebody typed it.
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
               VALUES ('cl1','CL-0123','individual','Thi Ngoc Anh Le','Thi Ngoc Anh','Le','active','${AT}','${AT}')`);
    // A reference well clear of the counter, which a seeded row does not
    // advance — the route allocates the next one itself and would collide.
    h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
               VALUES ('k0','CASE-26-900','cl1','WV. AEWV — Thi Ngoc Anh Le','An older matter',
                       'wv_aewv','lodged','${USER.id}','${AT}','${AT}')`);
    return h;
  }

  it('is put into the house style when it is used', async () => {
    const h = withOldRecord();
    const done = await normaliseClientName(h.env as any, 'cl1', TYPES);
    expect(done).toEqual({ was: 'Thi Ngoc Anh Le', now: 'Thi Ngoc Anh LE', matters: 1 });
    const row = h.get<{ family_name: string; full_name: string }>(
      'SELECT family_name, full_name FROM clients')!;
    expect(row.family_name).toBe('LE');
    expect(row.full_name).toBe('Thi Ngoc Anh LE');
  });

  it('carries the correction into the matters already named after them', async () => {
    const h = withOldRecord();
    await normaliseClientName(h.env as any, 'cl1', TYPES);
    expect(h.get<{ title: string }>(`SELECT title FROM cases WHERE id = 'k0'`)!.title)
      .toBe('WV. AEWV — Thi Ngoc Anh LE');
  });

  it('does nothing at all to a record already right', async () => {
    // The ordinary case, and it must cost nothing and say nothing.
    const h = withOldRecord();
    h.db.exec(`UPDATE clients SET family_name = 'LE', full_name = 'Thi Ngoc Anh LE'`);
    expect(await normaliseClientName(h.env as any, 'cl1', TYPES)).toBeNull();
  });

  it('does not restyle a company', async () => {
    const h = withOldRecord();
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,family_name,status,created_at,updated_at)
               VALUES ('org1','CL-0200','organisation','Land Meat New Zealand Limited',
                       'Land Meat New Zealand Limited','active','${AT}','${AT}')`);
    expect(await normaliseClientName(h.env as any, 'org1', TYPES)).toBeNull();
    expect(h.get<{ full_name: string }>(`SELECT full_name FROM clients WHERE id = 'org1'`)!.full_name)
      .toBe('Land Meat New Zealand Limited');
  });

  it('happens when a matter is opened onto that record, and is noted on the file', async () => {
    // The route the practice actually used.
    const h = withOldRecord();
    const res = await h.post('/assistant/intake/apply', {
      existing_client_id: 'cl1',
      descriptor: 'Peak Seasonal Work Visa',
      case_type: 'wv_aewv', status: 'engaged', assigned_to: USER.id,
      a_kind: 'individual', a_given_names: 'Thi Ngoc Anh', a_family_name: 'Le',
      party_count: '0',
    });
    expect(res.status).toBe(303);
    expect(h.get<{ full_name: string }>('SELECT full_name FROM clients')!.full_name)
      .toBe('Thi Ngoc Anh LE');
    // And the new matter is named from the corrected spelling, not the old one.
    const opened = h.get<{ title: string }>(
      `SELECT title FROM cases WHERE ref <> 'CASE-26-900' ORDER BY created_at DESC`)!;
    expect(opened.title).toBe('WV. AEWV — Thi Ngoc Anh LE');
    const note = h.get<{ body: string }>(
      `SELECT body FROM entries WHERE entity_type = 'client' AND body LIKE '%capitals%'`);
    expect(note?.body, 'a name changed with nothing on the file to say why').toContain('Thi Ngoc Anh LE');
  });
});

/**
 * Given names in ordinary case, which is the other half of the same rule.
 *
 * Asked for on 8 September 2026, immediately after the surnames: *"the reverse
 * is true for given names — they should be normalised. Not VAN CHIEN but Van
 * Chien."*
 *
 * The pair is the point. A passport prints the whole name in capitals and so
 * does an INZ letter, so anything read out of a document arrives shouted end to
 * end. Capitalising only the family name is what makes it legible at a glance
 * which half is which — and half this practice's caseload has names whose order
 * is not the English one.
 */
describe('a given name', () => {
  it('is put into ordinary case when it is shouted', () => {
    expect(givenNamesFor('VAN CHIEN')).toBe('Van Chien');
    expect(givenNamesFor('THI NGOC ANH')).toBe('Thi Ngoc Anh');
    expect(givenNamesFor('van chien')).toBe('Van Chien');
  });

  it('is left exactly as it is when somebody has styled it', () => {
    // "VAN CHIEN" is a shift key. These are decisions, and re-casing them would
    // be the register inventing a style the person did not use — MacLeod would
    // come back Macleod and nothing here could know better.
    for (const name of ['McKenzie', 'de Jong', 'Anne-Marie', "d'Angelo", 'MacLeod', 'Jo-Ann']) {
      expect(givenNamesFor(name)).toBe(name);
    }
  });

  it('capitalises after a hyphen and an apostrophe when it does act', () => {
    expect(givenNamesFor('ANNE-MARIE')).toBe('Anne-Marie');
    expect(givenNamesFor("O'BRIEN")).toBe("O'Brien");
  });

  it('leaves nothing to trip over', () => {
    expect(givenNamesFor(null)).toBe('');
    expect(givenNamesFor('   ')).toBe('');
  });

  it('is what the whole name and the formal name are built from', () => {
    // Both of those are what appears on a matter, a file label and an export.
    expect(composeFullName('individual', { givenNames: 'VAN CHIEN', familyName: 'nguyen' }))
      .toBe('Van Chien NGUYEN');
    expect(formalName({ givenNames: 'VAN CHIEN', familyName: 'nguyen' }))
      .toBe('NGUYEN, Van Chien');
  });

  it('is applied by the form a person actually uses', async () => {
    const h = mountModule(clientsModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    await h.post('/clients', {
      kind: 'individual', given_names: 'VAN CHIEN', family_name: 'nguyen', status: 'prospect',
    });
    const row = h.get<{ given_names: string; full_name: string; family_name: string }>(
      'SELECT given_names, full_name, family_name FROM clients')!;
    expect(row.given_names).toBe('Van Chien');
    expect(row.family_name).toBe('NGUYEN');
    expect(row.full_name).toBe('Van Chien NGUYEN');
  });
});

describe('the shouted given names already in the register', () => {
  const REPAIR = '0071_given_names_in_ordinary_case.sql';

  function seededShouting() {
    const db = upTo(REPAIR);
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','t@example.test','A Tester','x','admin','active','${AT}','${AT}')`);
    const client = db.prepare(
      `INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'active','${AT}','${AT}')`);
    client.run('cl1', 'CL-0001', 'individual', 'VAN CHIEN NGUYEN', 'VAN CHIEN', 'NGUYEN');
    // Already right, and must not be touched.
    client.run('cl2', 'CL-0002', 'individual', 'Thi Ngoc Anh LE', 'Thi Ngoc Anh', 'LE');
    // Somebody's own styling.
    client.run('cl3', 'CL-0003', 'individual', 'de Jong VAN DAM', 'de Jong', 'VAN DAM');
    db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-26-901','cl1','RV. Partner — VAN CHIEN NGUYEN','A description',
                     'rv_partner','lodged','u1','${AT}','${AT}')`);
    return db;
  }

  it('are put into ordinary case, and the whole name rebuilt', () => {
    const db = seededShouting();
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    const row = one(db, `SELECT given_names AS g, full_name AS n FROM clients WHERE id = 'cl1'`);
    expect(row.g).toBe('Van Chien');
    expect(row.n).toBe('Van Chien NGUYEN');
  });

  it('carries the correction into the matters named after them', () => {
    const db = seededShouting();
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT title AS t FROM cases WHERE id = 'k1'`).t)
      .toBe('RV. Partner — Van Chien NGUYEN');
  });

  it('leaves alone the ones that were already right, and the ones somebody styled', () => {
    const db = seededShouting();
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT given_names AS g FROM clients WHERE id = 'cl2'`).g).toBe('Thi Ngoc Anh');
    expect(one(db, `SELECT given_names AS g FROM clients WHERE id = 'cl3'`).g).toBe('de Jong');
  });

  it('produces exactly what the application’s own rule would', () => {
    // The migration is a second implementation of `givenNamesFor`, written in
    // SQL because a migration cannot call the first one. Two implementations of
    // one rule is how 190 matter names picked up a carriage return, so the two
    // are held against each other here.
    const db = seededShouting();
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT given_names AS g FROM clients WHERE id = 'cl1'`).g)
      .toBe(givenNamesFor('VAN CHIEN'));
  });

  it('leaves nothing behind for a second run to find', () => {
    const db = seededShouting();
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT COUNT(*) AS n FROM clients
                     WHERE kind = 'individual' AND given_names IS NOT NULL
                       AND TRIM(given_names) <> '' AND given_names = UPPER(given_names)`).n).toBe(0);
  });
});
