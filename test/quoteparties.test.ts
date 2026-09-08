/**
 * Everybody the engagement is with, on the quotation.
 *
 * The practice's decision, 8 September 2026: the Letter of Engagement will not
 * restate the parties, the scope or the fees — it is a covering letter, and the
 * quotation attached to it is the substance. That only works if a quotation can
 * name more than one person, and until migration 0065 it named exactly one.
 *
 * A real letter of theirs names five people: the client, a partner, a child,
 * and two administrative contacts at an agency. Four of those five had nowhere
 * to live, so they were retyped into Word every time.
 *
 * These rows end up in a contract, so the rules are in the database rather than
 * in the route that happens to be writing — and the tests attack the database
 * directly, because acceptance will write these rows too and it does not go
 * through the form.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { quotesModule } from '../src/modules/quotes';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-01T09:00:00Z';
const USER = fakeUser();

/** The schema as it finally stands, with one quotation on it. */
function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    d.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  d.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
          VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
  d.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,status,created_at,updated_at)
          VALUES ('q1','Q-0001','cl1','Partner Resident Visa',700000,'draft','${AT}','${AT}')`);
  return d;
}

/** One party row, with only what the test cares about spelled out. */
const add = (d: any, over: Record<string, unknown> = {}) => {
  const row = {
    id: `qp_${Math.random().toString(36).slice(2, 9)}`, quote_id: 'q1', position: 0,
    role: 'associated', kind: 'person', full_name: 'A PERSON', relationship: null,
    date_of_birth: null, organisation: null, email: null, phone: null,
    client_id: null, is_representative: 0, ...over,
  };
  return (d.prepare(
    `INSERT INTO quote_parties (id, quote_id, position, role, kind, full_name, relationship,
        date_of_birth, organisation, email, phone, client_id, is_representative,
        created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'${AT}','${AT}')`) as any).run(
    row.id, row.quote_id, row.position, row.role, row.kind, row.full_name, row.relationship,
    row.date_of_birth, row.organisation, row.email, row.phone, row.client_id, row.is_representative);
};

describe('what the database refuses on a party', () => {
  it('refuses a party with no name', () => {
    // It would print as a blank line in a contract.
    expect(() => add(db(), { full_name: '' })).toThrow(/has to have a name/);
    expect(() => add(db(), { full_name: '   ' })).toThrow(/has to have a name/);
  });

  it('refuses a name emptied by an edit, not only by an insert', () => {
    const d = db();
    add(d, { id: 'p1' });
    expect(() => d.exec("UPDATE quote_parties SET full_name = '' WHERE id = 'p1'"))
      .toThrow(/has to have a name/);
  });

  it('refuses a birthday on an organisation', () => {
    // A company has no birthday: it is somebody filling in the wrong box, and
    // it would print as one.
    expect(() => add(db(), { kind: 'organisation', full_name: 'AN AGENCY LTD',
                             date_of_birth: '1987-04-18' })).toThrow(/no date of birth/);
  });

  it('refuses one given to an organisation by an edit', () => {
    const d = db();
    add(d, { id: 'p1', kind: 'organisation', full_name: 'AN AGENCY LTD' });
    expect(() => d.exec("UPDATE quote_parties SET date_of_birth = '1987-04-18' WHERE id = 'p1'"))
      .toThrow(/no date of birth/);
  });

  it('refuses a date of birth that is not a date', () => {
    // INZ reads these off the letter. "18/04/1987" in the wrong format is a
    // discrepancy in an application, not a display problem.
    for (const bad of ['18/04/1987', '1987-4-18', 'April 1987', '1987-13-01', '2026-02-30']) {
      expect(() => add(db(), { date_of_birth: bad }), `${bad} was accepted`)
        .toThrow(/real date in the past/);
    }
  });

  it('refuses a date of birth in the future', () => {
    expect(() => add(db(), { date_of_birth: '2099-01-01' })).toThrow(/in the past/);
  });

  it('takes a real one', () => {
    const d = db();
    add(d, { date_of_birth: '1987-04-18' });
    expect((d.prepare('SELECT date_of_birth AS v FROM quote_parties') as any).get().v)
      .toBe('1987-04-18');
  });

  it('refuses an administrative contact nobody can reach', () => {
    // Their whole purpose is to be contacted. A name in a contract with no way
    // to reach them is worse than no name: the client is told to deal with
    // somebody unreachable.
    expect(() => add(db(), { role: 'admin_contact' }))
      .toThrow(/email address or a phone number/);
    expect(() => add(db(), { role: 'admin_contact', email: '  ' }))
      .toThrow(/email address or a phone number/);
  });

  it('takes one with either an email or a phone', () => {
    const d = db();
    add(d, { role: 'admin_contact', full_name: 'Ms M', email: 'm@agency.test' });
    add(d, { role: 'admin_contact', full_name: 'Mr T', phone: '+64 21 000 0000' });
    expect((d.prepare(
      `SELECT COUNT(*) AS n FROM quote_parties WHERE role = 'admin_contact'`) as any).get().n).toBe(2);
  });

  it('refuses one being emptied of both by an edit', () => {
    const d = db();
    add(d, { id: 'p1', role: 'admin_contact', email: 'm@agency.test' });
    expect(() => d.exec("UPDATE quote_parties SET email = NULL WHERE id = 'p1'"))
      .toThrow(/email address or a phone number/);
  });

  it('refuses somebody who may not instruct being nominated to instruct', () => {
    expect(() => add(db(), { role: 'admin_contact', email: 'm@agency.test', is_representative: 1 }))
      .toThrow(/cannot be the nominated representative/);
  });

  it('refuses a second person nominated to instruct', () => {
    // Two people authorised to give instructions is the ambiguity the clause
    // exists to remove.
    const d = db();
    add(d, { full_name: 'FIRST', is_representative: 1 });
    expect(() => add(d, { full_name: 'SECOND', is_representative: 1 })).toThrow(/UNIQUE|constraint/i);
  });

  it('lets a different quotation nominate its own', () => {
    // The rule is one per quotation, not one in the register.
    const d = db();
    d.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,status,created_at,updated_at)
            VALUES ('q2','Q-0002','cl1','Another matter',100000,'draft','${AT}','${AT}')`);
    add(d, { full_name: 'FIRST', is_representative: 1 });
    add(d, { quote_id: 'q2', full_name: 'SECOND', is_representative: 1 });
    expect((d.prepare(
      'SELECT COUNT(*) AS n FROM quote_parties WHERE is_representative = 1') as any).get().n).toBe(2);
  });

  it('goes with the quotation when the quotation goes', () => {
    const d = db();
    add(d);
    add(d, { full_name: 'ANOTHER' });
    d.exec("DELETE FROM quotes WHERE id = 'q1'");
    expect((d.prepare('SELECT COUNT(*) AS n FROM quote_parties') as any).get().n).toBe(0);
  });
});

describe('adding people through the page', () => {
  function seeded() {
    const h = mountModule(quotesModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
                  VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
    h.db.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,status,created_at,updated_at)
               VALUES ('q1','Q-0001','cl1','Partner Resident Visa',700000,'draft','${AT}','${AT}')`);
    return h;
  }

  it('adds a person with their relationship and birthday', async () => {
    const h = seeded();
    const res = await h.post('/quotes/q1/parties', {
      full_name: 'CHAU, THI BICH TAM', role: 'associated', kind: 'person',
      relationship: 'partner', date_of_birth: '1987-04-18',
    });
    expect(res.status).toBe(303);
    const row = h.get<{ full_name: string; relationship: string; date_of_birth: string }>(
      'SELECT full_name, relationship, date_of_birth FROM quote_parties')!;
    expect(row.full_name).toBe('CHAU, THI BICH TAM');
    expect(row.relationship).toBe('partner');
    expect(row.date_of_birth).toBe('1987-04-18');
  });

  it('shows the database’s own words when it refuses, not "could not save"', async () => {
    // The refusals are sentences written for the practice. A handler that
    // replaces them with a generic failure sends somebody to the developer to
    // find out what a perfectly clear message already said.
    const h = seeded();
    const res = await h.post('/quotes/q1/parties', {
      full_name: 'AN AGENCY', role: 'admin_contact', kind: 'organisation',
    });
    expect(res.status).toBe(303);
    const said = decodeURIComponent(res.headers.get('location') ?? '');
    expect(said).toContain('email address or a phone number');
  });

  it('writes nothing when the database refuses', async () => {
    const h = seeded();
    await h.post('/quotes/q1/parties', { full_name: 'AN AGENCY', role: 'admin_contact' });
    expect(h.count('SELECT COUNT(*) AS n FROM quote_parties')).toBe(0);
  });

  it('never puts a birthday on an organisation, whatever the form says', async () => {
    // The form offers both boxes and somebody will fill in both. Dropped here
    // as well as refused there, so the common case is not an error page.
    const h = seeded();
    await h.post('/quotes/q1/parties', {
      full_name: 'AN AGENCY LTD', role: 'associated', kind: 'organisation',
      date_of_birth: '1987-04-18',
    });
    expect(h.get<{ date_of_birth: string | null }>(
      'SELECT date_of_birth FROM quote_parties')!.date_of_birth).toBe(null);
  });

  it('saves edits and removes the ticked ones in one press', async () => {
    const h = seeded();
    await h.post('/quotes/q1/parties', { full_name: 'FIRST', role: 'associated' });
    await h.post('/quotes/q1/parties', { full_name: 'SECOND', role: 'associated' });
    const ids = (h.db.prepare('SELECT id FROM quote_parties ORDER BY position') as any)
      .all() as Array<{ id: string }>;
    expect(ids.length).toBe(2);

    await h.post('/quotes/q1/parties', {
      _action: 'save',
      [`full_name_${ids[0]!.id}`]: 'FIRST, CORRECTED',
      [`role_${ids[0]!.id}`]: 'applicant',
      [`kind_${ids[0]!.id}`]: 'person',
      [`representative_${ids[0]!.id}`]: '1',
      [`remove_${ids[1]!.id}`]: '1',
    });

    const rows = (h.db.prepare(
      'SELECT full_name, role, is_representative FROM quote_parties') as any).all() as any[];
    expect(rows.length, 'the ticked one was not removed').toBe(1);
    expect(rows[0].full_name).toBe('FIRST, CORRECTED');
    expect(rows[0].role).toBe('applicant');
    expect(rows[0].is_representative).toBe(1);
  });

  it('lists applicants first, then associated parties, then the contacts', async () => {
    // The order the letter reads them in. A document whose sections shuffle
    // between drafts is a document nobody trusts.
    const h = seeded();
    await h.post('/quotes/q1/parties', { full_name: 'A CONTACT', role: 'admin_contact', email: 'a@b.test' });
    await h.post('/quotes/q1/parties', { full_name: 'AN ASSOCIATE', role: 'associated' });
    await h.post('/quotes/q1/parties', { full_name: 'AN APPLICANT', role: 'applicant' });
    const { quoteParties } = await import('../src/modules/quotes');
    const listed = await quoteParties(h.env as never, 'q1');
    expect(listed.map((p) => p.full_name))
      .toEqual(['AN APPLICANT', 'AN ASSOCIATE', 'A CONTACT']);
  });

  it('shows them on the quotation, and says who may instruct', async () => {
    const h = seeded();
    await h.post('/quotes/q1/parties', {
      full_name: 'CHAU, THI BICH TAM', role: 'associated', relationship: 'partner',
    });
    const body = await (await h.request('/quotes/q1')).text();
    expect(body).toContain('CHAU, THI BICH TAM');
    expect(body).toContain('partner');
    expect(body, 'the page must say the client instructs when nobody else is nominated')
      .toContain('the letter will say the client');
  });
});

/**
 * The quotation as the client reads it.
 *
 * This is the half that matters legally: the practice's decision is that the
 * Letter of Engagement states no parties, no scope and no fees — it refers to
 * the quotation, and the quotation is what says who the engagement is with. A
 * quotation that holds the parties but does not print them would leave the
 * letter referring to nothing.
 */
describe('the printed quotation states who the engagement is with', () => {
  function seeded() {
    const h = mountModule(quotesModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('cl1','CL-0001','individual','NGUYEN, ANH TAN','active','${AT}','${AT}')`);
    h.db.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,status,created_at,updated_at)
               VALUES ('q1','Q-0001','cl1','Partner Resident Visa',700000,'draft','${AT}','${AT}')`);
    return h;
  }

  /**
   * The document, with its whitespace flattened.
   *
   * The templates wrap, so a sentence in the source arrives with newlines and
   * indentation inside it. A test matching the sentence as written would fail
   * on correct output — and, worse, a test that avoided the problem by matching
   * three words would pass on a sentence that had lost its meaning.
   */
  const printed = async (h: ReturnType<typeof seeded>) =>
    (await (await h.request('/quotes/q1/print')).text()).replace(/\s+/g, ' ');

  it('names the client, the applicants and the associated parties', async () => {
    const h = seeded();
    await h.post('/quotes/q1/parties', {
      full_name: 'CHAU, THI BICH TAM', role: 'associated', relationship: 'partner',
      date_of_birth: '1987-04-18',
    });
    await h.post('/quotes/q1/parties', { full_name: 'NGUYEN, MINH THANH', role: 'applicant' });

    const doc = await printed(h);
    expect(doc).toContain('The parties');
    expect(doc).toContain('NGUYEN, ANH TAN');
    expect(doc).toContain('CHAU, THI BICH TAM');
    expect(doc).toContain('NGUYEN, MINH THANH');
    expect(doc, 'their relationship is what makes the row mean anything').toContain('partner');
    expect(doc, 'a date of birth is read off this document by INZ').toContain('18 Apr 1987');
  });

  it('says the client instructs when nobody else is nominated', async () => {
    // The default in the practice's own letter: "The Client is Nominated
    // Representative". Silence here would leave a contract that does not say
    // whose instructions bind it.
    const h = seeded();
    await h.post('/quotes/q1/parties', { full_name: 'CHAU, THI BICH TAM', role: 'associated' });
    expect(await printed(h)).toContain('Nominated representative for all parties');
  });

  it('names the nominated person instead, when there is one', async () => {
    const h = seeded();
    await h.post('/quotes/q1/parties', {
      full_name: 'CHAU, THI BICH TAM', role: 'associated', is_representative: '1',
    });
    const doc = await printed(h);
    expect(doc).toMatch(/CHAU, THI BICH TAM<\/strong> is nominated to give/);
    expect(doc, 'two people cannot both be said to instruct')
      .not.toContain('Nominated representative for all parties');
  });

  it('sets out what an administrative contact may and may not do', async () => {
    // The clause exists because the contact is often an overseas agency. A
    // contract that names them without limiting them is a contract that lets
    // them look like the lawyer.
    const h = seeded();
    await h.post('/quotes/q1/parties', {
      full_name: 'Ms My (Megan) Nguyen', role: 'admin_contact',
      organisation: 'Oceania Immigration', email: 'my@example.test',
    });
    const doc = await printed(h);
    expect(doc).toContain('Day-to-day administrative contact');
    expect(doc).toContain('Oceania Immigration');
    expect(doc).toContain('not authorised to give legal advice');
    expect(doc).toContain('All legal advice and all decisions come from the lawyer');
  });

  it('says nothing about administrative contacts when there are none', async () => {
    // A paragraph limiting the authority of nobody is a paragraph raising a
    // question the client did not have.
    const h = seeded();
    expect(await printed(h)).not.toContain('Day-to-day administrative contact');
  });
});
