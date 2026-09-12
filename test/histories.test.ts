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
    expect(rows[0]!.employer).toBe(null);
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
      { kind: 'employed', employer: 'One', started_on: '2020-01-01', ended_on: '2021-06-30' });
    const res = await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer: 'Two', started_on: '2023-03-01' });
    expect(res.status).toBe(303);
    expect(rowsOf(h, 'client_employment')).toHaveLength(2);
  });

  it('is drawn on the employment history and not on the others', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer: 'One', started_on: '2020-01-01', ended_on: '2021-06-30' });
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer: 'Two', started_on: '2023-03-01', ended_on: '2024-01-01' });
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
      { kind: 'employed', employer: 'Old name', role: 'Chef', country: 'NZ' });
    const [row] = rowsOf(h, 'client_employment');

    await h.post('/clients/cl1/history/employment', {
      [`position_${row!.id}`]: '1',
      [`kind_${row!.id}`]: 'self_employed',
      [`employer_${row!.id}`]: 'New name',
      [`role_${row!.id}`]: 'Head chef',
      [`country_${row!.id}`]: 'VN',
      [`started_on_${row!.id}`]: '2021-02-01',
      [`notes_${row!.id}`]: 'Bought the business.',
    });
    const after = rowsOf(h, 'client_employment')[0]!;
    expect(after.kind).toBe('self_employed');
    expect(after.employer).toBe('New name');
    expect(after.role).toBe('Head chef');
    expect(after.country).toBe('VN');
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
    await h.post('/clients/cl1/history/employment/add', { kind: 'employed', employer: 'One' });
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
  it.each(['client_employment', 'client_education', 'client_travel'])(
    '%s refuses a period that ends before it starts', (table) => {
      const db = bareRegister();
      expect(() => db.prepare(
        `INSERT INTO ${table} (id, client_id, started_on, ended_on, created_at, updated_at)
         VALUES ('x','c1','2021-01-01','2020-01-01',?,?)`).run(AT, AT))
        .toThrow(/cannot end before it starts/);
    });

  it.each(['client_employment', 'client_education', 'client_travel'])(
    '%s refuses a country that is not one', (table) => {
      const db = bareRegister();
      expect(() => db.prepare(
        `INSERT INTO ${table} (id, client_id, country, created_at, updated_at)
         VALUES ('x','c1','Vietnam',?,?)`).run(AT, AT))
        .toThrow(/ISO 3166-1 alpha-2/);
    });

  it.each(['client_employment', 'client_education', 'client_travel'])(
    '%s bounds the note', (table) => {
      const db = bareRegister();
      expect(() => db.prepare(
        `INSERT INTO ${table} (id, client_id, notes, created_at, updated_at)
         VALUES ('x','c1',?,?,?)`).run('x'.repeat(1001), AT, AT))
        .toThrow(/1000 characters or fewer/);
    });

  it.each(['client_employment', 'client_education', 'client_travel'])(
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
  it('shows all three, each closed', async () => {
    const body = await (await mount().request('/clients/cl1')).text();
    for (const def of HISTORIES) {
      expect(body, def.title).toContain(`<h2>${def.title}</h2>`);
      const at = body.indexOf(`<h2>${def.title}</h2>`);
      const tag = body.slice(body.lastIndexOf('<details', at), body.indexOf('>', body.lastIndexOf('<details', at)));
      expect(tag, `${def.title} should start closed`).not.toMatch(/ open/);
    }
  });

  it('shows the military block, as a placeholder and nothing more', async () => {
    // *"create the block but keep it as a placeholder for now."* There is
    // deliberately no table behind it: the shape of a military record is the
    // part nobody has decided.
    const body = await (await mount().request('/clients/cl1')).text();
    expect(body).toContain('<h2>Military records</h2>');
    expect(body).toContain('Not built yet.');
    expect(body).not.toContain('history/military');
  });

  it('shows none of them on an organisation', async () => {
    const h = mount();
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('org1','CL-0902','organisation','Acme Limited','active','${AT}','${AT}')`);
    const body = await (await h.request('/clients/org1')).text();
    expect(body).not.toContain('<h2>Employment history</h2>');
    expect(body).not.toContain('<h2>Military records</h2>');
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

  it('so the database accepts a word that is not on today’s list', () => {
    // The proof that these are configuration rather than schema: an
    // administrator adds "Medical treatment" to the reasons for a trip and it
    // stores, with no migration. A CHECK listing today's words would need one.
    const h = mount();
    h.db.prepare(
      `INSERT INTO client_travel (id, client_id, purpose, mode, created_at, updated_at)
       VALUES ('t9','cl1','medical_treatment','ferry',?,?)`).run(AT, AT);
    h.db.prepare(
      `INSERT INTO client_education (id, client_id, completed, created_at, updated_at)
       VALUES ('e9','cl1','abandoned',?,?)`).run(AT, AT);
    expect(rowsOf(h, 'client_travel')[0]!.purpose).toBe('medical_treatment');
    expect(rowsOf(h, 'client_education')[0]!.completed).toBe('abandoned');
  });

  it('but still refuses a paragraph in place of a word', () => {
    // The one rule they do carry, and it is the database's.
    const h = mount();
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
      kind: 'employed', employer: 'Lagos Meat Company',
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
      kind: 'employed', employer: 'Kaitiaki Foods', started_on: '2024-06-10',
    });
    expect(rowsOf(h, 'client_employment')[0]!.started_on).toBe('2024-06-10');
  });

  it('shows a month as a month, not as the first of it', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer: 'Lagos Meat Company', started_on: '2018-02',
    });
    const body = await (await h.request('/clients/cl1?open=history-employment')).text();
    expect(body).toContain('2018-02');
    expect(body).not.toContain('01 Feb 2018');
  });

  it('refuses anything that is neither', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1/history/employment/add', {
      kind: 'employed', employer: 'Somewhere', started_on: 'March 2018',
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
      kind: 'employed', employer: 'A Cabinetmaker', started_on: '2015', ended_on: '2019-08',
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
      { kind: 'employed', employer: 'First', started_on: '2018-01' });
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer: 'Second', started_on: '2019-01' });
    const [a, b] = rowsOf(h, 'client_employment');

    const res = await h.post('/clients/cl1/history/employment', {
      [`kind_${a!.id}`]: 'employed', [`employer_${a!.id}`]: 'Changed first',
      [`started_on_${a!.id}`]: '2018-01',
      [`kind_${b!.id}`]: 'employed', [`employer_${b!.id}`]: 'Changed second',
      [`started_on_${b!.id}`]: 'nonsense',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('err=');

    const after = rowsOf(h, 'client_employment');
    expect(after[0]!.employer, 'the good row must not have been written either').toBe('First');
    expect(after[1]!.employer).toBe('Second');
  });

  it('saves both when both are right', async () => {
    const h = mount();
    await h.post('/clients/cl1/history/employment/add',
      { kind: 'employed', employer: 'First', started_on: '2018-01' });
    const [a] = rowsOf(h, 'client_employment');
    const res = await h.post('/clients/cl1/history/employment', {
      [`kind_${a!.id}`]: 'employed', [`employer_${a!.id}`]: 'Changed first',
      [`started_on_${a!.id}`]: '2018-01-15',
    });
    expect(res.status).toBe(303);
    const after = rowsOf(h, 'client_employment')[0]!;
    expect(after.employer).toBe('Changed first');
    expect(after.started_on).toBe('2018-01-15');
  });
});
