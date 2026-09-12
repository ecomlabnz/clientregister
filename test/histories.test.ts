/**
 * Employment, education and travel, under a client.
 *
 * **Asked for on 11 September 2026:** *"build placeholders for the histories
 * discussed - employment, education, international travel ... they will live
 * under a client ... each also starts collapsed, they are not mandatory, but
 * can be filled by the AI ... Critical - periods of unemployment must also be
 * able to be entered into the Employment history with appropriate notes. IF AI
 * is filling it in - it must leave blank space if there is a gap, the user must
 * be able to move the table rows up or down - if possible, and add or delete
 * more lines for the entries."*
 *
 * Four things in that paragraph are requirements rather than description, and
 * each has a test here:
 *
 *  * a period of unemployment is a row, with a note, and needs no employer;
 *  * a gap between two periods is **shown**, never refused;
 *  * rows reorder, and lines are added and taken away;
 *  * the blocks start closed.
 *
 * The database rules are attacked directly, as the rest of this suite does,
 * because a rule that only holds when the route is involved is not a rule.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { gapsIn, HISTORIES, type HistoryRow } from '../src/core/histories';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser();

function bareRegister() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
  return db;
}

function mount() {
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0901','individual','A Person','active','${AT}','${AT}')`);
  return h;
}

const rowsOf = (h: ReturnType<typeof mount>, table: string) =>
  h.db.prepare(`SELECT * FROM ${table} WHERE client_id = 'cl1' ORDER BY position, created_at`)
    .all() as unknown as HistoryRow[];

// ---------------------------------------------------------------------------
// The row that had to be possible
// ---------------------------------------------------------------------------

describe('a period of unemployment is a row like any other', () => {
  it('saves with no employer and no role, carrying its note', async () => {
    // The practice called this out as critical. A work history with the gaps
    // left out is not a work history: INZ asks about them, and "unemployed,
    // looking for work" is an answer rather than a missing row.
    const h = mount();
    const res = await h.post('/clients/cl1/history/employment/add', {
      kind: 'unemployed', started_on: '2023-04-01', ended_on: '2023-11-30',
      notes: 'Made redundant; looking for work throughout.',
    });
    expect(res.status).toBe(303);

    const rows = rowsOf(h, 'client_employment');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('unemployed');
    expect(rows[0]!.employer_and_supervisor).toBe(null);
    expect(rows[0]!.role).toBe(null);
    expect(rows[0]!.notes).toContain('Made redundant');
  });

  it('the database asks for no employer either', () => {
    // Not only the form. A reading that fills a history in is a second way in.
    const db = bareRegister();
    db.prepare(
      `INSERT INTO client_employment (id, client_id, kind, notes, created_at, updated_at)
       VALUES ('e1','c1','unemployed','Caring for a parent',?,?)`).run(AT, AT);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM client_employment`) as any).get().n).toBe(1);
  });

  it('offers unemployed in the list an administrator can edit', () => {
    // Every dropdown the practice uses is editable without a deployment, and
    // this is exactly the list that differs between practices.
    const vocab = readFileSync('src/core/vocabulary.ts', 'utf8');
    expect(vocab).toContain("key: 'vocab.employment_kinds'");
    expect(vocab).toContain('unemployed | Unemployed');
  });
});

// ---------------------------------------------------------------------------
// The gap is shown, not refused
// ---------------------------------------------------------------------------

describe('a gap between two periods', () => {
  const row = (over: Partial<HistoryRow>): HistoryRow =>
    ({ id: 'x', position: 0, notes: null, started_on: null, ended_on: null, ...over } as HistoryRow);

  it('is found where two periods do not meet', () => {
    const gaps = gapsIn([
      row({ started_on: '2020-01-01', ended_on: '2021-06-30' }),
      row({ started_on: '2022-03-01', ended_on: '2023-01-31' }),
    ]);
    expect(gaps.has(1)).toBe(true);
    expect(gaps.get(1)).toBeGreaterThan(200);
  });

  it('is not found where one job runs into the next', () => {
    // A person who left on the Friday and started on the Monday has not been
    // unemployed, and a marker about it would be exactly the noise the practice
    // has asked twice not to have.
    const gaps = gapsIn([
      row({ started_on: '2020-01-01', ended_on: '2021-06-30' }),
      row({ started_on: '2021-07-05', ended_on: '2023-01-31' }),
    ]);
    expect(gaps.size).toBe(0);
  });

  it('is found whichever way round the practice has ordered the table', () => {
    // Most people write a history newest first. The order is the practice's to
    // choose, so the gap is read from whichever pair of dates is the earlier.
    const gaps = gapsIn([
      row({ started_on: '2022-03-01', ended_on: '2023-01-31' }),
      row({ started_on: '2020-01-01', ended_on: '2021-06-30' }),
    ]);
    expect(gaps.has(1)).toBe(true);
  });

  it('is not looked for where a row has no dates yet', () => {
    const gaps = gapsIn([
      row({ started_on: '2020-01-01', ended_on: '2021-06-30' }),
      row({}),
    ]);
    expect(gaps.size).toBe(0);
  });

  it('is never a refusal', async () => {
    // A history part-way through entry legitimately has gaps, and a gap is
    // often the true answer. Nothing about it stops a row being saved.
    const h = mount();
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'One', started_on: '2020-01-01', ended_on: '2021-06-30' });
    const res = await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'Two', started_on: '2023-03-01' });
    expect(res.status).toBe(303);
    expect(rowsOf(h, 'client_employment')).toHaveLength(2);
  });

  it('is drawn on the employment history and not on the others', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'One', started_on: '2020-01-01', ended_on: '2021-06-30' });
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'Two', started_on: '2023-03-01', ended_on: '2024-01-01' });
    await h.post('/clients/cl1/history/travel/add',
      { country: 'VN', started_on: '2020-01-01', ended_on: '2020-02-01' });
    await h.post('/clients/cl1/history/travel/add',
      { country: 'AU', started_on: '2024-01-01', ended_on: '2024-02-01' });

    const body = await (await h.request('/clients/cl1')).text();
    expect(body).toContain('history-gap');
    // One marker, from the employment table. The travel rows are four years
    // apart and that is not a gap in anything — it is the rest of a life.
    expect(body.match(/history-gap/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Adding, reordering, removing
// ---------------------------------------------------------------------------

describe('the table is edited the way quotation lines are', () => {
  it('reorders by the number typed in the # box', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/education/add',
      { institution: 'First', started_on: '2010-01-01' });
    await h.post('/clients/cl1/history/education/add',
      { institution: 'Second', started_on: '2014-01-01' });
    const before = rowsOf(h, 'client_education');
    expect(before.map((r) => r.institution)).toEqual(['First', 'Second']);

    await h.post('/clients/cl1/history/education', {
      [`position_${before[0]!.id}`]: '2', [`institution_${before[0]!.id}`]: 'First',
      [`position_${before[1]!.id}`]: '1', [`institution_${before[1]!.id}`]: 'Second',
    });
    expect(rowsOf(h, 'client_education').map((r) => r.institution)).toEqual(['Second', 'First']);
  });

  it('takes a line out when its cross is ticked', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/travel/add', { country: 'VN', purpose: 'Family' });
    await h.post('/clients/cl1/history/travel/add', { country: 'AU', purpose: 'Work' });
    const rows = rowsOf(h, 'client_travel');

    await h.post('/clients/cl1/history/travel', {
      [`position_${rows[0]!.id}`]: '1', [`country_${rows[0]!.id}`]: 'VN',
      [`position_${rows[1]!.id}`]: '2', [`country_${rows[1]!.id}`]: 'AU',
      [`remove_${rows[1]!.id}`]: 'on',
    });
    const after = rowsOf(h, 'client_travel');
    expect(after).toHaveLength(1);
    expect(after[0]!.country).toBe('VN');
  });

  it('edits every field of every row in one press', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'Old name', role: 'Chef',
        location: 'Hamilton, New Zealand' });
    const [row] = rowsOf(h, 'client_employment');

    await h.post('/clients/cl1/history/employment', {
      [`position_${row!.id}`]: '1',
      [`kind_${row!.id}`]: 'self_employed',
      [`employer_and_supervisor_${row!.id}`]: 'New name',
      [`role_${row!.id}`]: 'Head chef',
      [`location_${row!.id}`]: 'Vinh, Nghe An',
      [`duties_${row!.id}`]: 'Standard duties of a head chef.',
      [`started_on_${row!.id}`]: '2021-02-01',
      [`notes_${row!.id}`]: 'Bought the business.',
    });
    const after = rowsOf(h, 'client_employment')[0]!;
    expect(after.kind).toBe('self_employed');
    expect(after.employer_and_supervisor).toBe('New name');
    expect(after.role).toBe('Head chef');
    expect(after.location).toBe('Vinh, Nghe An');
    expect(after.duties).toBe('Standard duties of a head chef.');
    expect(after.started_on).toBe('2021-02-01');
    expect(after.notes).toBe('Bought the business.');
  });

  it('refuses an empty row rather than storing a blank line', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/travel/add', {});
    expect(res.status).toBe(303);
    expect(rowsOf(h, 'client_travel')).toHaveLength(0);
  });

  it('writes to the file and the audit log', async () => {
    // A history is a claim about somebody's life that goes onto an application.
    // A register that cannot say when a period appeared is worse than one that
    // never held it.
    const h = mount();
    await h.post('/clients/cl1/history/employment/add', { kind: 'employed', employer_and_supervisor: 'One' });
    const notes = h.db.prepare(
      `SELECT body FROM entries WHERE entity_id = 'cl1'`).all() as Array<{ body: string }>;
    expect(notes.map((n) => n.body).join('\n')).toContain('Employment history');
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'client.history_added'`))
      .toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The database's own rules
// ---------------------------------------------------------------------------

describe('the database refuses what it can check', () => {
  it.each(['client_employment', 'client_education', 'client_travel', 'client_military'])(
    '%s refuses a period that ends before it starts', (table) => {
      const db = bareRegister();
      expect(() => db.prepare(
        `INSERT INTO ${table} (id, client_id, started_on, ended_on, created_at, updated_at)
         VALUES ('x','c1','2021-01-01','2020-01-01',?,?)`).run(AT, AT))
        .toThrow(/cannot end before it starts/);
    });

  // Employment is not on this list any more, and that is the point of migration
  // 0100: its country became a free-text Location on 12 September 2026, because
  // the answer the practice actually gets is "Vinh, Nghe An" as often as it is a
  // country. The three that still hold a country still refuse one that is not.
  it.each(['client_education', 'client_travel', 'client_military'])(
    '%s refuses a country that is not one', (table) => {
      const db = bareRegister();
      expect(() => db.prepare(
        `INSERT INTO ${table} (id, client_id, country, created_at, updated_at)
         VALUES ('x','c1','Vietnam',?,?)`).run(AT, AT))
        .toThrow(/ISO 3166-1 alpha-2/);
    });

  it.each(['client_employment', 'client_education', 'client_travel', 'client_military'])(
    '%s bounds the note', (table) => {
      const db = bareRegister();
      expect(() => db.prepare(
        `INSERT INTO ${table} (id, client_id, notes, created_at, updated_at)
         VALUES ('x','c1',?,?,?)`).run('x'.repeat(1001), AT, AT))
        .toThrow(/1000 characters or fewer/);
    });

  it.each(['client_employment', 'client_education', 'client_travel', 'client_military'])(
    '%s goes with the client', (table) => {
      const db = bareRegister();
      db.prepare(`INSERT INTO ${table} (id, client_id, created_at, updated_at)
                  VALUES ('x','c1',?,?)`).run(AT, AT);
      db.prepare(`DELETE FROM clients WHERE id = 'c1'`).run();
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`) as any).get().n).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// On the page
// ---------------------------------------------------------------------------

describe('on the client page', () => {
  it('shows all four, each closed', async () => {
    const body = await (await mount().request('/clients/cl1')).text();
    for (const def of HISTORIES) {
      expect(body, def.title).toContain(`<h2>${def.title}</h2>`);
      const at = body.indexOf(`<h2>${def.title}</h2>`);
      const tag = body.slice(body.lastIndexOf('<details', at), body.indexOf('>', body.lastIndexOf('<details', at)));
      expect(tag, `${def.title} should start closed`).not.toMatch(/ open/);
    }
  });

  it('shows the military block with a table behind it now', async () => {
    // It was a heading and "Not built yet" from 11 September until the practice
    // decided the shape of it the next day: *"yes build the three questions,
    // but the table - nothing fancy - just bare bones info."*
    const body = await (await mount().request('/clients/cl1')).text();
    expect(body).toContain('<h2>Military service</h2>');
    expect(body).not.toContain('Not built yet.');
    expect(body).toContain('history/military');
  });

  it('shows none of them on an organisation', async () => {
    const h = mount();
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('org1','CL-0902','organisation','Acme Limited','active','${AT}','${AT}')`);
    const body = await (await h.request('/clients/org1')).text();
    expect(body).not.toContain('<h2>Employment history</h2>');
    expect(body).not.toContain('<h2>Military service</h2>');
  });
});

// ---------------------------------------------------------------------------
// What the practice asked for the day after
// ---------------------------------------------------------------------------

/**
 * **Asked for on 12 September 2026:** *"For Education History - another box -
 * whether complete or incomplete. For Travel history the purpose should contain
 * options Family, Holiday, Business, Work, and another field - mode of travel
 * should have by Air, Sea, Land."*
 *
 * All three are lists an administrator edits, like every other dropdown here.
 * `purpose` had been free text for one day and held nothing in the practice's
 * register, so it became a list directly rather than through a translation
 * nobody would have needed — checked against production before the migration
 * was written.
 */
describe('whether a course was finished', () => {
  it('saves against the row', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/education/add', {
      institution: 'Wintec', qualification: 'Diploma in Business',
      started_on: '2025-02-17', ended_on: '2026-11-30', completed: 'completed',
    });
    expect(rowsOf(h, 'client_education')[0]!.completed).toBe('completed');
  });

  it('offers completed, not completed and still studying', async () => {
    // Three rather than two: "still studying" is the answer for every client
    // currently on a student visa and is neither of the other two.
    const h = mount();
    const body = await (await h.request('/clients/cl1?open=history-education')).text();
    for (const label of ['Completed', 'Not completed', 'Still studying']) {
      expect(body, label).toContain(label);
    }
  });

  it('is not compulsory, like the rest of a history', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/education/add', { institution: 'Wintec' });
    expect(res.status).toBe(303);
    expect(rowsOf(h, 'client_education')[0]!.completed).toBe(null);
  });
});

describe('how a trip was made, and why', () => {
  it('saves both against the row', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/travel/add', {
      country: 'AU', purpose: 'family', mode: 'air',
      started_on: '2025-12-18', ended_on: '2026-01-20',
    });
    const row = rowsOf(h, 'client_travel')[0]!;
    expect(row.purpose).toBe('family');
    expect(row.mode).toBe('air');
  });

  it('offers the purposes the practice named', async () => {
    const h = mount();
    const body = await (await h.request('/clients/cl1?open=history-travel')).text();
    for (const label of ['Family', 'Holiday', 'Business', 'Work']) {
      expect(body, label).toContain(`>${label}<`);
    }
  });

  it('offers air, sea and land', async () => {
    const h = mount();
    const body = await (await h.request('/clients/cl1?open=history-travel')).text();
    for (const label of ['Air', 'Sea', 'Land']) {
      expect(body, label).toContain(`>${label}<`);
    }
  });

  it('shows the labels back, not the stored keys', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/travel/add', {
      country: 'AU', purpose: 'family', mode: 'air', started_on: '2025-12-18',
    });
    const body = await (await h.request('/clients/cl1?open=history-travel')).text();
    expect(body).toContain('Family');
    expect(body).toContain('Air');
  });
});

describe('the three new lists are an administrator’s', () => {
  it('are registered as vocabularies, like every other dropdown', async () => {
    const { VOCABULARIES } = await import('../src/core/vocabulary');
    const keys = VOCABULARIES.map((v) => v.key);
    expect(keys).toContain('vocab.education_outcomes');
    expect(keys).toContain('vocab.travel_purposes');
    expect(keys).toContain('vocab.travel_modes');
  });

  /**
   * **Rewritten on 12 September 2026, with migration 0101.**
   *
   * This used to read *"so the database accepts a word that is not on today's
   * list"*, and it proved the right thing the wrong way: that these lists are
   * configuration rather than schema, demonstrated by the database accepting
   * anything at all. That was also the hole 35 client records fell through.
   *
   * The rule has not changed — an administrator still adds a word without a
   * migration — but the proof has. The word has to be **on their list**, and
   * putting it there is the thing that needs no deployment.
   */
  it('so an administrator adds a word to the list and it stores, with no migration', () => {
    const h = mount();
    const add = (key: string, terms: string) => h.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)`).run(key, terms, AT);

    // Before: not on the list, so the database will not take it.
    expect(() => h.db.prepare(
      `INSERT INTO client_travel (id, client_id, purpose, created_at, updated_at)
       VALUES ('t8','cl1','medical_treatment',?,?)`).run(AT, AT))
      .toThrow(/not on the practice's list/);

    add('vocab.travel_purposes', 'family | Family\nmedical_treatment | Medical treatment');
    add('vocab.education_outcomes', 'completed | Completed\nabandoned | Abandoned');

    // After: it stores, and nothing was deployed to make that true.
    h.db.prepare(
      `INSERT INTO client_travel (id, client_id, purpose, mode, created_at, updated_at)
       VALUES ('t9','cl1','medical_treatment','sea',?,?)`).run(AT, AT);
    h.db.prepare(
      `INSERT INTO client_education (id, client_id, completed, created_at, updated_at)
       VALUES ('e9','cl1','abandoned',?,?)`).run(AT, AT);
    expect(rowsOf(h, 'client_travel')[0]!.purpose).toBe('medical_treatment');
    expect(rowsOf(h, 'client_education')[0]!.completed).toBe('abandoned');
  });

  it('but still refuses a paragraph in place of a word', () => {
    // 0090's rule, and it is now the *second* thing that would refuse this: a
    // sixty-one character value is off every list as well as too long, and
    // `parseVocabulary` will not make a key longer than sixty, so it can never
    // be put on one. To prove the length rule is still there rather than the
    // list rule standing in for it, the list is taken away first — which is
    // exactly the state in which 0101's guard stands aside.
    const h = mount();
    h.db.exec(`DELETE FROM vocabulary_defaults WHERE setting_key = 'vocab.travel_modes'`);
    expect(() => h.db.prepare(
      `INSERT INTO client_travel (id, client_id, mode, created_at, updated_at)
       VALUES ('t8','cl1',?,?,?)`).run('x'.repeat(61), AT, AT))
      .toThrow(/a word, not a sentence/);
  });
});

// ---------------------------------------------------------------------------
// A date that may be a month
// ---------------------------------------------------------------------------

/**
 * **Asked for on 12 September 2026:** *"in the histories - can we allow filling
 * in only the Month and year if the date is not available?"*
 *
 * Yes, and it is the ordinary case: a person remembers leaving a job in March
 * 2019, an application form asks MM/YYYY, a reference letter says "June 2015 to
 * August 2018". Migration 0089 said to use the 1st, which is the register
 * writing down a day nobody said.
 *
 * The interesting half is the arithmetic. A month is not a point, so which end
 * of it is meant depends on what the date *is*: a period that started in March
 * began at the start of March; one that ended in March ran to the end of it.
 * Reading both as the 1st would invent a month-long gap after every period that
 * ends in a month — which is exactly the noise the practice has asked twice not
 * to have.
 */
describe('a history date may be a day, a month or a year', () => {
  it('saves a month against a row', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer_and_supervisor: 'Lagos Meat Company',
      started_on: '2018-02', ended_on: '2024-01',
    });
    expect(res.status).toBe(303);
    const row = rowsOf(h, 'client_employment')[0]!;
    expect(row.started_on).toBe('2018-02');
    expect(row.ended_on).toBe('2024-01');
  });

  it('still saves a whole date', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer_and_supervisor: 'Kaitiaki Foods', started_on: '2024-06-10',
    });
    expect(rowsOf(h, 'client_employment')[0]!.started_on).toBe('2024-06-10');
  });

  it('shows a month as a month, not as the first of it', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer_and_supervisor: 'Lagos Meat Company', started_on: '2018-02',
    });
    const body = await (await h.request('/clients/cl1?open=history-employment')).text();
    expect(body).toContain('2018-02');
    expect(body).not.toContain('01 Feb 2018');
  });

  it('refuses anything that is neither', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer_and_supervisor: 'Somewhere', started_on: 'March 2018',
    });
    expect(res.status).not.toBe(500);
    expect(rowsOf(h, 'client_employment')).toEqual([]);
  });

  it('and the database refuses it too, whatever the route', () => {
    // The rule is the database's; the form check is so the message names the
    // box. A bulk load or a reading of a document is the other way in.
    const h = mount();
    expect(() => h.db.prepare(
      `INSERT INTO client_employment (id, client_id, started_on, created_at, updated_at)
       VALUES ('e9','cl1','2019-3-1',?,?)`).run(AT, AT))
      .toThrow(/a day, a month or a year/);
    expect(() => h.db.prepare(
      `INSERT INTO client_travel (id, client_id, ended_on, created_at, updated_at)
       VALUES ('t9','cl1','not a date',?,?)`).run(AT, AT))
      .toThrow(/a day, a month or a year/);
    // A year is four digits and nothing else: '19' and '2019-' are not years.
    expect(() => h.db.prepare(
      `INSERT INTO client_employment (id, client_id, started_on, created_at, updated_at)
       VALUES ('e8','cl1','19',?,?)`).run(AT, AT))
      .toThrow(/a day, a month or a year/);
  });

  /**
   * **Asked for on 12 September 2026**, for the education history's award
   * date: *"should be able to enter full date or month and year or just year."*
   * A year is now a third precision everywhere a history date is kept, because
   * one convention across the three tables beats two.
   */
  it('saves a year on its own, and keeps it a year', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer_and_supervisor: 'A Cabinetmaker', started_on: '2015', ended_on: '2019-08',
    });
    expect(res.status).toBe(303);
    const row = rowsOf(h, 'client_employment')[0]!;
    expect(row.started_on).toBe('2015');
    expect(row.ended_on).toBe('2019-08');
  });

  it('takes a year on the education award date, which is why this exists', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/education/add', {
      institution: 'A Polytechnic', qualification: 'A Diploma',
      started_on: '2011', ended_on: '2013', awarded_on: '2014',
    });
    expect(res.status).toBe(303);
    const row = rowsOf(h, 'client_education')[0]!;
    expect(row.awarded_on).toBe('2014');
  });

  it('refuses a bad award date at the database, not only at the form', () => {
    const h = mount();
    expect(() => h.db.prepare(
      `INSERT INTO client_education (id, client_id, awarded_on, created_at, updated_at)
       VALUES ('ed9','cl1','sometime in 2014',?,?)`).run(AT, AT))
      .toThrow(/a day, a month or a year/);
  });

  it('still refuses a period that ends before it starts, across the two shapes', () => {
    // 0089's rule is a text comparison of two ISO strings, which is why it goes
    // on working: '2018-01' < '2019-03-15'.
    const h = mount();
    expect(() => h.db.prepare(
      `INSERT INTO client_employment (id, client_id, started_on, ended_on, created_at, updated_at)
       VALUES ('e8','cl1','2019-03-15','2018-01',?,?)`).run(AT, AT))
      .toThrow(/cannot end before it starts/);
  });
});

describe('the gap between two months', () => {
  it('reads a month end as its last day and a month start as its first', async () => {
    const { historyDateAt } = await import('../src/core/histories');
    expect(historyDateAt('2019-03', false)).toBe(Date.UTC(2019, 2, 1));
    expect(historyDateAt('2019-03', true)).toBe(Date.UTC(2019, 2, 31));
    // February, and a leap year, without knowing about either.
    expect(historyDateAt('2019-02', true)).toBe(Date.UTC(2019, 1, 28));
    expect(historyDateAt('2020-02', true)).toBe(Date.UTC(2020, 1, 29));
  });

  it('leaves a whole date alone', async () => {
    const { historyDateAt } = await import('../src/core/histories');
    expect(historyDateAt('2019-03-15', true)).toBe(Date.UTC(2019, 2, 15));
    expect(historyDateAt('2019-03-15', false)).toBe(Date.UTC(2019, 2, 15));
  });

  it('does not invent a gap between two months that meet', async () => {
    // Left in March, started in April. Reading both as the 1st would have made
    // that a 31-day gap and drawn a line.
    const { gapsIn } = await import('../src/core/histories');
    const rows = [
      { id: 'a', position: 1, notes: null, started_on: '2018-01', ended_on: '2019-03' },
      { id: 'b', position: 2, notes: null, started_on: '2019-04', ended_on: null },
    ] as never;
    expect(gapsIn(rows).size).toBe(0);
  });

  it('still finds a real one', async () => {
    const { gapsIn } = await import('../src/core/histories');
    const rows = [
      { id: 'a', position: 1, notes: null, started_on: '2018-01', ended_on: '2019-03' },
      { id: 'b', position: 2, notes: null, started_on: '2019-09', ended_on: null },
    ] as never;
    const gaps = gapsIn(rows);
    expect(gaps.size).toBe(1);
    expect(gaps.get(1)).toBeGreaterThan(140);
  });

  it('handles one of each shape', async () => {
    const { gapsIn } = await import('../src/core/histories');
    const rows = [
      { id: 'a', position: 1, notes: null, started_on: '2018-01-05', ended_on: '2019-03-31' },
      { id: 'b', position: 2, notes: null, started_on: '2019-04', ended_on: null },
    ] as never;
    expect(gapsIn(rows).size).toBe(0);
  });
});

describe('a bad date does not half-save a table', () => {
  it('writes nothing when one row of several is wrong', async () => {
    // The save is a row at a time, so a bad date on the fourth row would have
    // been found after three were written — a half-saved table, with no way for
    // the reader to tell which half.
    const h = mount();
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'First', started_on: '2018-01' });
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'Second', started_on: '2019-01' });
    const [a, b] = rowsOf(h, 'client_employment');

    const res = await h.post('/clients/cl1/history/employment', {
      [`kind_${a!.id}`]: 'employed', [`employer_and_supervisor_${a!.id}`]: 'Changed first',
      [`started_on_${a!.id}`]: '2018-01',
      [`kind_${b!.id}`]: 'employed', [`employer_and_supervisor_${b!.id}`]: 'Changed second',
      [`started_on_${b!.id}`]: 'nonsense',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('err=');

    const after = rowsOf(h, 'client_employment');
    expect(after[0]!.employer_and_supervisor,
      'the good row must not have been written either').toBe('First');
    expect(after[1]!.employer_and_supervisor).toBe('Second');
  });

  it('saves both when both are right', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer_and_supervisor: 'First', started_on: '2018-01' });
    const [a] = rowsOf(h, 'client_employment');
    const res = await h.post('/clients/cl1/history/employment', {
      [`kind_${a!.id}`]: 'employed', [`employer_and_supervisor_${a!.id}`]: 'Changed first',
      [`started_on_${a!.id}`]: '2018-01-15',
    });
    expect(res.status).toBe(303);
    const after = rowsOf(h, 'client_employment')[0]!;
    expect(after.employer_and_supervisor).toBe('Changed first');
    expect(after.started_on).toBe('2018-01-15');
  });
});

// ---------------------------------------------------------------------------
// Military service: the three questions, and the bare record under them
// ---------------------------------------------------------------------------

/**
 * **Asked for on 12 September 2026:** *"yes build the three questions, but the
 * table - nothing fancy - just bare bones info - we normally say in the INZ1200
 * - see the document attached and let them peruse the records."*
 *
 * Section D of INZ 1200 asks three questions and then a table of eleven
 * columns. The three questions are here in full; five of the eleven columns
 * are, and the other six are deliberately absent — which is a decision worth a
 * test of its own, because the next person to read the form will otherwise
 * wonder whether they were forgotten.
 */

/** The client form posts every box, so a partial post would blank the rest. */
const personForm = (over: Record<string, string> = {}) => ({
  kind: 'individual', given_names: 'A', family_name: 'PERSON', status: 'active', ...over,
});

describe('the three questions on Section D', () => {
  it('saves all three and the explanation of an exemption', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', personForm({
      military_compulsory: 'yes', military_served: 'no', military_exempt: 'yes',
      military_exemption_detail: 'Presented at 18 and was not called up; holds the certificate.',
    }));
    expect(res.status).toBe(303);
    const row = h.get<Record<string, string | null>>(
      `SELECT military_compulsory, military_served, military_exempt, military_exemption_detail
         FROM clients WHERE id = 'cl1'`)!;
    expect(row.military_compulsory).toBe('yes');
    expect(row.military_served).toBe('no');
    expect(row.military_exempt).toBe('yes');
    expect(row.military_exemption_detail).toContain('not called up');
  });

  it('shows the answers in the military block, each question asked in full', async () => {
    const h = mount();
    await h.post('/clients/cl1', personForm({
      military_compulsory: 'yes', military_served: 'no', military_exempt: 'no',
    }));
    const body = await (await h.request('/clients/cl1?open=history-military')).text();
    expect(body).toContain('Has military service ever been compulsory in their home country?');
    expect(body).toContain('Have they ever undertaken military service in any country?');
    expect(body).toContain('Were they exempt from military service?');
  });

  it('says “Not answered” where nobody has asked, which is not “No”', async () => {
    // The difference is the whole point on a character question: "we have not
    // asked" and "the client says no" are not the same answer, and a screen
    // that prints one as the other is how the wrong thing gets declared.
    const h = mount();
    const body = await (await h.request('/clients/cl1?open=history-military')).text();
    expect(body).toContain('Not answered');
  });

  it('refuses an explanation with no exemption to explain, and names the box', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', personForm({
      military_exempt: 'no', military_exemption_detail: 'Bought my way out.',
    }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('belongs with an answer of yes');
    expect(h.get<{ military_exemption_detail: string | null }>(
      `SELECT military_exemption_detail FROM clients WHERE id = 'cl1'`)!.military_exemption_detail)
      .toBe(null);
  });

  it('allows an exemption whose explanation has not been typed yet', async () => {
    // A half-filled record is ordinary. The rule runs one way only.
    const h = mount();
    const res = await h.post('/clients/cl1', personForm({ military_exempt: 'yes' }));
    expect(res.status).toBe(303);
    expect(h.get<{ military_exempt: string }>(
      `SELECT military_exempt FROM clients WHERE id = 'cl1'`)!.military_exempt).toBe('yes');
  });

  it('refuses a third answer built by hand', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', personForm({ military_served: 'maybe' }));
    expect(res.status).toBe(400);
    expect(h.get<{ military_served: string | null }>(
      `SELECT military_served FROM clients WHERE id = 'cl1'`)!.military_served).toBe(null);
  });

  it('and the database refuses both, whatever the route', () => {
    // The rules are the database's (migration 0099); the form checks are so the
    // message names the box. A bulk load or a reading of a document is the
    // other way in.
    const db = bareRegister();
    expect(() => db.prepare(
      `UPDATE clients SET military_served = 'maybe' WHERE id = 'c1'`).run())
      .toThrow(/is yes or no/);
    expect(() => db.prepare(
      `UPDATE clients SET military_exemption_detail = 'Bought out.' WHERE id = 'c1'`).run())
      .toThrow(/belongs to an answer of yes/);
    expect(() => db.prepare(
      `INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at,
                            military_compulsory)
       VALUES ('c2','CL-9002','individual','B Person','active',?,?,'unknown')`).run(AT, AT))
      .toThrow(/is yes or no/);
  });

  it('refuses turning an exemption to no while its explanation is still there', () => {
    // The pair has to hold at every moment, not only when it is created.
    const db = bareRegister();
    db.prepare(`UPDATE clients SET military_exempt = 'yes',
                    military_exemption_detail = 'Studying abroad.' WHERE id = 'c1'`).run();
    expect(() => db.prepare(
      `UPDATE clients SET military_exempt = 'no' WHERE id = 'c1'`).run())
      .toThrow(/belongs to an answer of yes/);
  });

  it('bounds the explanation, so a pasted document cannot land in it', () => {
    const db = bareRegister();
    expect(() => db.prepare(
      `UPDATE clients SET military_exempt = 'yes', military_exemption_detail = ? WHERE id = 'c1'`)
      .run('x'.repeat(2001)))
      .toThrow(/2000 characters or fewer/);
  });
});

describe('the military record itself', () => {
  it('is a history like the other three', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/military/add', {
      country: 'CO', unit: 'Batallón de Ingenieros No. 4', rank: 'Soldado',
      duties: 'Standard duties of a conscript sapper.', started_on: '2002-07', ended_on: '2003-06',
    });
    expect(res.status).toBe(303);
    const row = rowsOf(h, 'client_military')[0]!;
    expect(row.country).toBe('CO');
    expect(row.unit).toBe('Batallón de Ingenieros No. 4');
    expect(row.rank).toBe('Soldado');
    expect(String(row.duties)).toContain('conscript sapper');
    expect(row.started_on).toBe('2002-07');
    expect(row.ended_on).toBe('2003-06');
  });

  it('reorders, edits and removes in one press, like every other history', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/military/add', { country: 'CO', unit: 'First' });
    await h.post('/clients/cl1/history/military/add', { country: 'CO', unit: 'Second' });
    const rows = rowsOf(h, 'client_military');

    await h.post('/clients/cl1/history/military', {
      [`position_${rows[0]!.id}`]: '2', [`unit_${rows[0]!.id}`]: 'First, corrected',
      [`country_${rows[0]!.id}`]: 'CO',
      [`position_${rows[1]!.id}`]: '1', [`unit_${rows[1]!.id}`]: 'Second',
      [`country_${rows[1]!.id}`]: 'CO',
      [`remove_${rows[1]!.id}`]: 'on',
    });
    const after = rowsOf(h, 'client_military');
    expect(after).toHaveLength(1);
    expect(after[0]!.unit).toBe('First, corrected');
  });

  it('keeps to five things, and none of the form’s military hierarchy', async () => {
    // *"nothing fancy - just bare bones info."* Corps, division, brigade,
    // battalion and commanding officers are on the form's own table and are
    // deliberately not here: the practice attaches the service document and
    // lets INZ read them off it. This test exists so that absence reads as a
    // decision rather than an oversight.
    const { MILITARY_HISTORY } = await import('../src/core/histories');
    expect(MILITARY_HISTORY.columns.map((c) => c.name)).toEqual(
      ['country', 'unit', 'rank', 'duties', 'started_on', 'ended_on']);

    const h = mount();
    const body = await (await h.request('/clients/cl1?open=history-military')).text();
    for (const absent of ['Corps', 'Division', 'Brigade', 'Battalion', 'Commanding']) {
      expect(body, absent).not.toContain(`>${absent}<`);
    }
  });

  it('draws no gap marker between two postings', async () => {
    // A gap in a work history is a question INZ asks. A gap between two
    // postings is not, and drawing one would be noise.
    const h = mount();
    await h.post('/clients/cl1/history/military/add',
      { country: 'CO', unit: 'One', started_on: '2000-01', ended_on: '2001-01' });
    await h.post('/clients/cl1/history/military/add',
      { country: 'CO', unit: 'Two', started_on: '2005-01', ended_on: '2006-01' });
    const body = await (await h.request('/clients/cl1?open=history-military')).text();
    expect(body).not.toContain('history-gap');
  });

  it('bounds the unit, the rank and the duties at the database', () => {
    const h = mount();
    for (const [column, over] of [['unit', 201], ['rank', 121], ['duties', 501]] as const) {
      expect(() => h.db.prepare(
        `INSERT INTO client_military (id, client_id, ${column}, created_at, updated_at)
         VALUES ('m_${column}','cl1',?,?,?)`).run('x'.repeat(over), AT, AT), column)
        .toThrow(/short answers, not a document/);
    }
  });
});

// ---------------------------------------------------------------------------
// What section B1 asks of an employment row
// ---------------------------------------------------------------------------

/**
 * **Asked for on 12 September 2026**, three changes in the practice's words:
 * *"Name of the employer and supervisor name - can be joined"*, *"Country
 * should change to Location which will include whatever address the applicant
 * can provide"*, and a Duties box filled with *"Standard duties of [INSERT
 * ROLE]"*. Migration 0100.
 */
describe('an employment row after section B1', () => {
  it('takes an address in Location, which a country dropdown could never hold', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer_and_supervisor: 'Talleres Medellín — supervisor Óscar Restrepo',
      role: 'Panel beater', location: 'Medellín, Antioquia, Colombia',
      duties: 'Standard duties of a panel beater.',
    });
    expect(res.status).toBe(303);
    const row = rowsOf(h, 'client_employment')[0]!;
    expect(row.location).toBe('Medellín, Antioquia, Colombia');
    expect(String(row.employer_and_supervisor)).toContain('Óscar Restrepo');
    expect(row.duties).toBe('Standard duties of a panel beater.');
  });

  it('offers a text box for Location and not a list of countries', async () => {
    const h = mount();
    const body = await (await h.request('/clients/cl1?open=history-employment')).text();
    expect(body).toContain('Location');
    expect(body).not.toContain('<select id="f_location"');
    expect(body).not.toContain('<select name="location"');
  });

  it('says in the box what the practice writes in it', async () => {
    // The placeholder is the sentence they actually use, so the box is not
    // filled in three different ways by three people.
    const h = mount();
    const body = await (await h.request('/clients/cl1?open=history-employment')).text();
    expect(body).toContain('Standard duties of a carpenter');
    expect(body).toContain('Employer and supervisor');
    expect(body).toContain('supervisor’s name after it');
  });

  it('bounds the three boxes at the database', () => {
    const h = mount();
    for (const [column, over] of
      [['employer_and_supervisor', 301], ['location', 201], ['duties', 501]] as const) {
      expect(() => h.db.prepare(
        `INSERT INTO client_employment (id, client_id, ${column}, created_at, updated_at)
         VALUES ('e_${column}','cl1',?,?,?)`).run('x'.repeat(over), AT, AT), column)
        .toThrow(/short answers, not a document/);
    }
  });

  it('no longer refuses a location that is not a country code', () => {
    // The rule that used to be here was right for a country and wrong for an
    // address. It was dropped rather than worked around — migration 0100.
    const h = mount();
    h.db.prepare(`INSERT INTO client_employment (id, client_id, location, created_at, updated_at)
                  VALUES ('e7','cl1','Vinh, Nghe An',?,?)`).run(AT, AT);
    expect(rowsOf(h, 'client_employment')[0]!.location).toBe('Vinh, Nghe An');
  });
});
