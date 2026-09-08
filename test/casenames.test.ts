/**
 * A matter is named, not described.
 *
 * Migration 0026 split the two on purpose: `title` names the matter, and
 * `descriptor` is the line underneath saying what makes this one different from
 * the next one of the same kind for the same person. The New matter form then
 * undid it — one question, written into both columns — with a comment
 * explaining that a title fed from the description could not drift away from
 * it. True, and the wrong trade.
 *
 * Measured on 8 September 2026: 194 matters, 194 with `title = descriptor`,
 * average 84 characters, longest 144. The practice reported it from the other
 * end — the dashboard printing the same sentence twice on one row and cutting
 * off the client's name and the reference to do it.
 *
 * Two things are pinned here, and they are different in kind:
 *
 *  - **the repair** (migration 0066), rehearsed at the shape production had,
 *    which is the only thing that says 194 real matters survived it; and
 *  - **the derivation**, which has to keep holding afterwards — a name whose
 *    inputs change and does not follow them is how this happened the first
 *    time.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { caseName, caseNameFrom } from '../src/core/casename';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { casesModule } from '../src/modules/cases';
import { dashboardModule } from '../src/modules/dashboard';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const MIGRATION = '0066_a_matter_is_named_not_described.sql';
const AT = '2026-09-01T09:00:00Z';
const USER = fakeUser();

/**
 * The practice's own case-type list, not the shipped one.
 *
 * Shaped like the real setting — "key | Label" lines, with a comment and a
 * blank line in it, because the real ones have those and a parser that trips on
 * them would rename a hundred matters after a comment. The keys are invented:
 * what matters is that they are *not* the shipped defaults, so a migration
 * reading the defaults instead of the setting fails this test.
 */
const VOCAB = `# Residence
rv_partner_local | Partner Resident Visa
rv_child_local | Dependent Child Resident Visa

# Work
wv_aewv_local | Accredited Employer Work Visa`;

/**
 * The same list as the practice's own actually holds it.
 *
 * Saved from a browser, so every line ends CRLF. This is not a detail: the
 * fixture above ends its lines with \n, and that is precisely why the tests
 * guarding migration 0066 all passed while 190 of the 194 names in the live
 * register came out as "RV. Partner\r — BUI, DUC MANH". SQLite's `trim()`
 * strips spaces and nothing else; JavaScript's `.trim()` strips carriage
 * returns, so the application's parser was right and the SQL copy of it was
 * wrong, and a fixture tidier than the data agreed with the code instead of
 * with the register.
 */
const VOCAB_AS_SAVED = VOCAB.split('\n').join('\r\n');

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

/** 194 matters across 3 types, every one named by its own description. */
function seed(db: any) {
  db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
           VALUES ('u1','t@example.test','A Tester','x','admin','active','${AT}','${AT}')`);
  db.exec(`INSERT INTO settings (key, value, updated_at)
           VALUES ('vocab.case_types', '${VOCAB}', '${AT}')`);
  const addClient = db.prepare(
    `INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
     VALUES (?,?,'individual',?,'active','${AT}','${AT}')`);
  const addCase = db.prepare(
    `INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'lodged','u1','${AT}','${AT}')`);
  const types = ['rv_partner_local', 'rv_child_local', 'wv_aewv_local'];
  for (let i = 1; i <= 194; i += 1) {
    addClient.run(`cl${i}`, `CL-${String(i).padStart(4, '0')}`, `PERSON ${i} O'BRIEN`);
    // The real ones are sentences at this length, with the punctuation that
    // breaks a naive copy.
    const sentence = `Meat Process Worker, Canterbury, Northern Ranges Abattoir — batch item ${i} `
      + `of the cohort lodged together, O'Brien's "second" attempt`;
    addCase.run(`k${i}`, `CASE-26-${String(i).padStart(3, '0')}`, `cl${i}`,
                sentence, sentence, types[i % 3]!);
  }
  return 194;
}

const one = (db: any, sql: string): any => (db.prepare(sql) as any).get();

describe('repairing the names of matters already in the register', () => {
  it('renames every one, and loses not one row', () => {
    const db = upTo(MIGRATION);
    expect(seed(db)).toBe(194);
    const before = one(db, 'SELECT COUNT(*) AS n FROM cases').n;

    applyRepair(db);

    expect(one(db, 'SELECT COUNT(*) AS n FROM cases').n, 'a matter went missing').toBe(before);
    expect(one(db, 'SELECT COUNT(*) AS n FROM cases WHERE title = descriptor').n,
      'a matter is still named by its own description').toBe(0);
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k3'`).v)
      .toBe("Partner Resident Visa — PERSON 3 O'BRIEN");
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k1'`).v)
      .toBe("Dependent Child Resident Visa — PERSON 1 O'BRIEN");
  });

  it('does not touch one word of the descriptions', () => {
    // They are good text in the wrong column. The practice should not have to
    // rewrite 194 of them, and a repair that "tidied" them would be a repair
    // that lost what they wrote.
    const db = upTo(MIGRATION);
    seed(db);
    const before = one(db, `SELECT COUNT(*) AS n, SUM(LENGTH(descriptor)) AS chars,
                                   GROUP_CONCAT(descriptor) AS all_of_it
                              FROM (SELECT * FROM cases ORDER BY id)`);
    applyRepair(db);
    const after = one(db, `SELECT COUNT(*) AS n, SUM(LENGTH(descriptor)) AS chars,
                                  GROUP_CONCAT(descriptor) AS all_of_it
                             FROM (SELECT * FROM cases ORDER BY id)`);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('leaves a matter somebody has already named alone', () => {
    const db = upTo(MIGRATION);
    seed(db);
    db.exec(`UPDATE cases SET title = 'A NAME SOMEBODY CHOSE' WHERE id = 'k7'`);
    applyRepair(db);
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k7'`).v).toBe('A NAME SOMEBODY CHOSE');
  });

  it('reads the practice’s own list rather than the shipped defaults', () => {
    // The shipped list says `rv_partnership`; this practice's says `rv_partner`.
    // A migration written against the defaults would name a hundred matters
    // after a key nobody uses, and would pass a test that only counted rows.
    const db = upTo(MIGRATION);
    seed(db);
    applyRepair(db);
    const named = one(db, `SELECT COUNT(*) AS n FROM cases WHERE title LIKE 'Partner Resident Visa —%'`).n;
    expect(named, 'the labels did not come from the settings row').toBeGreaterThan(60);
    expect(one(db, `SELECT COUNT(*) AS n FROM cases WHERE title LIKE '%_local%'`).n,
      'a raw key was printed as a name').toBe(0);
  });

  it('is not tripped by the comments and blank lines a real list has', () => {
    const db = upTo(MIGRATION);
    seed(db);
    applyRepair(db);
    expect(one(db, `SELECT COUNT(*) AS n FROM cases WHERE title LIKE '#%'`).n).toBe(0);
    expect(one(db, `SELECT COUNT(*) AS n FROM cases WHERE title LIKE ' —%'`).n).toBe(0);
  });

  it('leaves a matter alone when there is nothing to build a name from', () => {
    // Renaming it to " — " would be worse than the sentence it had.
    const db = upTo(MIGRATION);
    seed(db);
    db.exec(`UPDATE cases SET case_type = '' WHERE id = 'k11'`);
    const was = one(db, `SELECT title AS v FROM cases WHERE id = 'k11'`).v;
    applyRepair(db);
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k11'`).v).toBe(was);
  });

  it('falls back to the key when a type is not on the list at all', () => {
    // Better a raw key than a matter with no name — and it is what the
    // application shows for the same case.
    const db = upTo(MIGRATION);
    seed(db);
    db.exec(`UPDATE cases SET case_type = 'retired_type' WHERE id = 'k13'`);
    applyRepair(db);
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k13'`).v)
      .toBe("retired_type — PERSON 13 O'BRIEN");
  });
});

describe('the name itself', () => {
  it('is the type and the person, the way the practice writes it', () => {
    expect(caseName('Partner Resident Visa', 'Bao Long VUONG'))
      .toBe('Partner Resident Visa — Bao Long VUONG');
  });

  it('is never empty, whatever it is given', () => {
    // `title` is NOT NULL. Returning '' here would trade a display problem for
    // a refused write.
    expect(caseName('', '')).toBeTruthy();
    expect(caseName('Partner Resident Visa', null)).toBe('Partner Resident Visa');
    expect(caseName('', 'Bao Long VUONG')).toBe('Bao Long VUONG');
  });

  it('puts the type first, so sorting by name groups by kind of work', () => {
    // The practice's own reason, 8 September 2026: "I like the case naming
    // where the visa type precedes the name — it allows me to sort the cases by
    // visa type, very helpful." Sorting by name is grouping by kind of work, on
    // every list, with no second column and no separate control. Reversing the
    // halves would take that away and nothing else would notice.
    const names = [
      caseName('WV. AEWV', 'ANNA ZULU'),
      caseName('RV. Partner', 'BEN ALPHA'),
      caseName('RV. Partner', 'ANNA ZULU'),
    ].sort();
    expect(names).toEqual([
      'RV. Partner — ANNA ZULU',
      'RV. Partner — BEN ALPHA',
      'WV. AEWV — ANNA ZULU',
    ]);
  });

  it('reads its label from the vocabulary it is given', () => {
    const types = [{ key: 'rv_partner', label: 'Partner Resident Visa' }];
    expect(caseNameFrom(types, 'rv_partner', 'A PERSON'))
      .toBe('Partner Resident Visa — A PERSON');
    expect(caseNameFrom(types, 'not_on_the_list', 'A PERSON'))
      .toBe('not_on_the_list — A PERSON');
  });
});

describe('the name follows what it is made of', () => {
  function seeded(mod: any) {
    const h = mountModule(mod, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.exec(`INSERT INTO settings (key, value, updated_at)
               VALUES ('vocab.case_types', '${VOCAB}', '${AT}')`);
    // Given and family names as well as the whole one, because the client form
    // composes `full_name` from the two halves — a seed that set only the whole
    // name would look like a rename the moment anything else was saved.
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
               VALUES ('cl1','CL-0001','individual','Duc Manh BUI','Duc Manh','BUI','active','${AT}','${AT}')`);
    return h;
  }

  it('names a new matter after its type and its client, not after its description', async () => {
    const h = seeded(casesModule);
    const res = await h.post('/cases', {
      client_id: 'cl1', case_type: 'rv_partner_local', assigned_to: USER.id, status: 'engaged',
      descriptor: 'Partner RV based on an existing partnership, second attempt after a refusal',
    });
    expect(res.status).toBe(303);
    const row = h.get<{ title: string; descriptor: string }>('SELECT title, descriptor FROM cases')!;
    expect(row.title).toBe('Partner Resident Visa — Duc Manh BUI');
    expect(row.descriptor, 'the description must survive unchanged')
      .toBe('Partner RV based on an existing partnership, second attempt after a refusal');
    expect(row.title === row.descriptor, 'named by its own description again').toBe(false);
  });

  it('renames the matter when the matter’s type is corrected', async () => {
    const h = seeded(casesModule);
    await h.post('/cases', {
      client_id: 'cl1', case_type: 'rv_partner_local', assigned_to: USER.id, status: 'engaged',
      descriptor: 'The description',
    });
    const id = h.get<{ id: string }>('SELECT id FROM cases')!.id;
    await h.post(`/cases/${id}`, {
      client_id: 'cl1', case_type: 'wv_aewv_local', assigned_to: USER.id,
      descriptor: 'The description',
    });
    expect(h.get<{ title: string }>('SELECT title FROM cases')!.title)
      .toBe('Accredited Employer Work Visa — Duc Manh BUI');
  });

  it('renames every matter when the client’s name is corrected', async () => {
    // Without this the old spelling stays on the front of every matter they
    // have — the drift this whole change exists to stop, arriving by the back
    // door.
    const h = seeded(clientsModule);
    h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
               VALUES ('k1','CASE-26-001','cl1','Partner Resident Visa — Duc Manh BUI',
                       'The description','rv_partner_local','lodged','${USER.id}','${AT}','${AT}'),
                      ('k2','CASE-26-002','cl1','Accredited Employer Work Visa — Duc Manh BUI',
                       'Another description','wv_aewv_local','lodged','${USER.id}','${AT}','${AT}')`);

    await h.post('/clients/cl1', {
      kind: 'individual', given_names: 'DUC MANH', family_name: 'BUI (CORRECTED)',
      status: 'active',
    });

    const titles = (h.db.prepare('SELECT title FROM cases ORDER BY id') as any)
      .all() as Array<{ title: string }>;
    // The register composes the full name from the two halves, so the corrected
    // spelling arrives here in the form the client record now holds.
    expect(titles.map((t) => t.title)).toEqual([
      'Partner Resident Visa — Duc Manh BUI (CORRECTED)',
      'Accredited Employer Work Visa — Duc Manh BUI (CORRECTED)',
    ]);
  });

  it('says on the client’s file that the matters were renamed', async () => {
    // A name that changed by itself, with nothing on the file to say why, is
    // the kind of thing somebody spends an afternoon on in a year's time.
    const h = seeded(clientsModule);
    h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
               VALUES ('k1','CASE-26-001','cl1','Partner Resident Visa — Duc Manh BUI',
                       'The description','rv_partner_local','lodged','${USER.id}','${AT}','${AT}')`);
    await h.post('/clients/cl1', {
      kind: 'individual', given_names: 'DUC MANH', family_name: 'BUI (CORRECTED)',
      status: 'active',
    });
    const note = h.get<{ body: string }>(
      `SELECT body FROM entries WHERE entity_type = 'client' AND body LIKE '%renamed%'`);
    expect(note?.body).toContain('1 matter was renamed');
  });

  it('leaves the matters alone when the client is edited but not renamed', async () => {
    const h = seeded(clientsModule);
    h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
               VALUES ('k1','CASE-26-001','cl1','A NAME SOMEBODY CHOSE',
                       'The description','rv_partner_local','lodged','${USER.id}','${AT}','${AT}')`);
    await h.post('/clients/cl1', {
      kind: 'individual', given_names: 'DUC MANH', family_name: 'BUI',
      status: 'active', phone: '021 000 0000',
    });
    expect(h.get<{ title: string }>('SELECT title FROM cases')!.title).toBe('A NAME SOMEBODY CHOSE');
  });
});

/**
 * The rows the practice actually reported, rendered.
 *
 * Their words, 8 September 2026: *"when narrowing the window the text is
 * hiding"*. The rows were clamped to two lines, and a two-line clamp holds
 * fewer characters as the column narrows — with nothing on the page to say the
 * rest existed. What it hid was the useful half: the reference and why the row
 * was there.
 *
 * Checked in Chromium at 390, 700, 1000 and 1400 px — no cell whose content
 * overflowed its box, the whole detail line present at every width, no sideways
 * scroll. Pinned here as the rule rather than the appearance, against the real
 * page rather than the source file.
 */
describe('a row on the dashboard shows what it says', () => {
  function seeded() {
    const h = mountModule(dashboardModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.exec(`INSERT INTO settings (key,value,updated_at)
               VALUES ('vocab.case_types', '${VOCAB}', '${AT}')`);
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
    h.db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,
                                  lodged_at,decision_due_at,created_at,updated_at)
               VALUES ('k1','CASE-26-043','cl1','Partner Resident Visa — A CLIENT',
                       'Meat Boners and Bandsaw Operators, ANZSCO skill level 3, second attempt',
                       'rv_partner_local','lodged','${USER.id}','2026-02-01','2026-03-01',
                       '${AT}','${AT}')`);
    return h;
  }

  it('clamps nothing, so nothing can be hidden by narrowing the window', async () => {
    const h = seeded();
    const body = await (await h.request('/')).text();
    const at = body.indexOf('Needs you today');
    expect(at, 'the card is not on the page').toBeGreaterThan(-1);
    const card = body.slice(at, body.indexOf('</section>', at));
    expect(card, 'a clamped row hides its own text as the column narrows')
      .not.toMatch(/class="[^"]*clamp-/);
  });

  it('says the matter once and the description once', async () => {
    // The fault as reported: the detail column restated the name and then ran
    // out of room for the reference.
    const h = seeded();
    const body = await (await h.request('/')).text();
    const at = body.indexOf('Needs you today');
    const card = body.slice(at, body.indexOf('</section>', at));
    // Counted per row, not per card: one matter can raise several rows — a
    // decision due, no INZ number, no visa recorded — and each of those is a
    // separate thing to do that names the matter once.
    const rows = card.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    expect(rows.length, 'no rows rendered').toBeGreaterThan(0);
    for (const row of rows) {
      const named = (row.match(/Partner Resident Visa — A CLIENT/g) ?? []).length;
      expect(named, 'the matter is named twice on one row').toBeLessThanOrEqual(1);
    }
    expect(card, 'the reference is what the row is for').toContain('CASE-26-043');
  });
});

describe('a name carries no stray line ending', () => {
  const REPAIR = '0069_a_name_carries_no_stray_line_ending.sql';

  /**
   * The register as it stood the moment before the repair: rows in place, then
   * 0066 run over them. Seeded before 0066 rather than after, because 0066 is
   * the thing that put the carriage return there — a database seeded after it
   * has nothing for the repair to fix and every test below would pass on
   * nothing.
   */
  function seededWithRealLineEndings() {
    const db = upTo(MIGRATION);
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','t@example.test','A Tester','x','admin','active','${AT}','${AT}')`);
    db.exec(`INSERT INTO settings (key, value, updated_at)
             VALUES ('vocab.case_types', '${VOCAB_AS_SAVED}', '${AT}')`);
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','A PERSON','active','${AT}','${AT}')`);
    db.exec(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-26-001','cl1','A description','A description',
                     'rv_partner_local','lodged','u1','${AT}','${AT}')`);
    applyRepair(db);
    return db;
  }

  it('is what 0066 produced from a vocabulary saved by a browser', () => {
    // The fault itself, reproduced: everything up to but not including the
    // repair. If this ever stops carrying a carriage return, the repair below
    // is testing nothing.
    const db = seededWithRealLineEndings();
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k1'`).v)
      .toBe('Partner Resident Visa\r — A PERSON');
  });

  it('takes it out, and leaves the rest of the name alone', () => {
    const db = seededWithRealLineEndings();
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k1'`).v)
      .toBe('Partner Resident Visa — A PERSON');
  });

  it('leaves a name that never had one untouched', () => {
    const db = seededWithRealLineEndings();
    db.exec(`UPDATE cases SET title = 'A NAME SOMEBODY CHOSE' WHERE id = 'k1'`);
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT title AS v FROM cases WHERE id = 'k1'`).v).toBe('A NAME SOMEBODY CHOSE');
  });

  it('cleans a description pasted out of a document too', () => {
    const db = seededWithRealLineEndings();
    db.exec(`UPDATE cases SET descriptor = 'Meat Process Worker,' || char(13) || ' Canterbury' WHERE id = 'k1'`);
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT descriptor AS v FROM cases WHERE id = 'k1'`).v)
      .toBe('Meat Process Worker, Canterbury');
  });

  it('leaves no control character anywhere in a name afterwards', () => {
    const db = seededWithRealLineEndings();
    db.exec(readFileSync(`migrations/${REPAIR}`, 'utf8'));
    expect(one(db, `SELECT COUNT(*) AS n FROM cases
                     WHERE title GLOB '*' || char(13) || '*'
                        OR title GLOB '*' || char(10) || '*'
                        OR title GLOB '*' || char(9) || '*'`).n).toBe(0);
  });

  it('is not how the application reads that same list', () => {
    // The application's parser was never wrong — JavaScript's trim() strips a
    // carriage return. Only the SQL copy of the rule was, which is what a
    // second implementation of one rule costs.
    const parsed = VOCAB_AS_SAVED.split('\n')
      .map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
      .map((line) => line.slice(line.indexOf('|') + 1).trim());
    expect(parsed).toEqual([
      'Partner Resident Visa', 'Dependent Child Resident Visa', 'Accredited Employer Work Visa',
    ]);
  });
});
