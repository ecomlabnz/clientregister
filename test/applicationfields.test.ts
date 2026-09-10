/**
 * The flat facts an application form asks for.
 *
 * **Asked for on 11 September 2026:** *"the application-form field gaps - lets
 * build in those that are easy - you mentioned that some are easy to build and
 * others require more work."*
 *
 * `docs/pipeline.md` item 0b divides the gap into three kinds and only the
 * first is built: the flat facts about a person — place of birth, title,
 * gender, relationship status, other names ever used, and a national identity
 * number with the country that issued it. Histories and declarations are
 * deliberately not here.
 *
 * The database rules are attacked directly, as `test/certcache.test.ts` does,
 * because the whole point of putting a rule in the database is that it holds
 * when the route is not involved — a bulk load, a fix by hand, a second handler
 * somebody adds next year.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { planReading } from '../src/ai/casefill';
import type { ClientFacts } from '../src/ai/casefill';
import { fillEmptyClientFields, setNationalIdentity } from '../src/core/clientfill';
import { parseVocabulary, GENDER_VOCAB, RELATIONSHIP_STATUS_VOCAB, TITLE_VOCAB }
  from '../src/core/vocabulary';
import { normaliseIntake } from '../src/ai/provider';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser();

// ---------------------------------------------------------------------------
// The database, with nothing in front of it.
// ---------------------------------------------------------------------------

function bareRegister() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
  const set = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...(args as never[]));
  return { db, set };
}

describe('half a national identity number is refused by the database', () => {
  it('refuses a number with no country, on insert', () => {
    // A twelve-digit string is a Vietnamese CCCD, an Indian Aadhaar or a typing
    // slip depending entirely on who issued it.
    const { set } = bareRegister();
    expect(() => set(
      `INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at,
                            national_id_number)
       VALUES ('c2','CL-9002','individual','B Person','active',?,?,'079203001234')`, AT, AT))
      .toThrow(/must say which country issued it/);
  });

  it('refuses a country with no number, on insert', () => {
    const { set } = bareRegister();
    expect(() => set(
      `INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at,
                            national_id_country)
       VALUES ('c2','CL-9002','individual','B Person','active',?,?,'VN')`, AT, AT))
      .toThrow(/belongs with the number/);
  });

  it('refuses a number with no country, on update', () => {
    // The pair has to hold at every moment, not only at the moment of creation:
    // a number can be typed today and its country meant for next week.
    const { set } = bareRegister();
    expect(() => set("UPDATE clients SET national_id_number = '079203001234' WHERE id = 'c1'"))
      .toThrow(/must say which country issued it/);
  });

  it('refuses a country with no number, on update', () => {
    const { set } = bareRegister();
    expect(() => set("UPDATE clients SET national_id_country = 'VN' WHERE id = 'c1'"))
      .toThrow(/belongs with the number/);
  });

  it('refuses taking the country back off a pair already recorded', () => {
    const { db, set } = bareRegister();
    set(`UPDATE clients SET national_id_number = '079203001234', national_id_country = 'VN'
          WHERE id = 'c1'`);
    expect(() => set("UPDATE clients SET national_id_country = NULL WHERE id = 'c1'"))
      .toThrow(/must say which country issued it/);
    expect((db.prepare("SELECT national_id_country v FROM clients WHERE id='c1'") as any)
      .get().v).toBe('VN');
  });

  it('takes both together, and lets both go together', () => {
    const { db, set } = bareRegister();
    set(`UPDATE clients SET national_id_number = '079203001234', national_id_country = 'VN'
          WHERE id = 'c1'`);
    expect((db.prepare("SELECT national_id_number v FROM clients WHERE id='c1'") as any)
      .get().v).toBe('079203001234');
    set("UPDATE clients SET national_id_number = NULL, national_id_country = NULL WHERE id = 'c1'");
    expect((db.prepare("SELECT national_id_number v FROM clients WHERE id='c1'") as any)
      .get().v).toBe(null);
  });

  it('is not satisfied by an empty string, which is what a form sends', () => {
    // `IS NULL` would have let this through, and a form that submits an
    // untouched box submits '' rather than nothing.
    const { set } = bareRegister();
    expect(() => set(
      `UPDATE clients SET national_id_number = '079203001234', national_id_country = ''
        WHERE id = 'c1'`)).toThrow(/must say which country issued it/);
  });
});

describe('a country in these columns is a real country', () => {
  it('refuses a place of birth that is not a country code', () => {
    const { set } = bareRegister();
    expect(() => set("UPDATE clients SET birth_country = 'Vietnam' WHERE id = 'c1'"))
      .toThrow(/ISO 3166-1 alpha-2/);
    expect(() => set("UPDATE clients SET birth_country = 'ZZ' WHERE id = 'c1'"))
      .toThrow(/ISO 3166-1 alpha-2/);
  });

  it('refuses an issuing country that is not a country code', () => {
    const { set } = bareRegister();
    expect(() => set(
      `UPDATE clients SET national_id_number = '079203001234', national_id_country = 'Viet Nam'
        WHERE id = 'c1'`)).toThrow(/ISO 3166-1 alpha-2/);
  });

  it('takes a code that is on the list', () => {
    const { db, set } = bareRegister();
    set("UPDATE clients SET birth_country = 'VN', birth_region = 'Nghe An', birth_town = 'Vinh' WHERE id = 'c1'");
    const row = (db.prepare(
      "SELECT birth_country c, birth_region r, birth_town t FROM clients WHERE id='c1'") as any).get();
    expect([row.c, row.r, row.t]).toEqual(['VN', 'Nghe An', 'Vinh']);
  });
});

// ---------------------------------------------------------------------------
// The vocabularies.
// ---------------------------------------------------------------------------

describe('the three new lists are the practice’s to edit', () => {
  it('seeds gender with Immigration New Zealand’s own three values', () => {
    // So what is recorded matches what the form asks for, and nobody has to
    // translate at the moment of copying.
    expect(parseVocabulary(GENDER_VOCAB.defaults).map((t) => t.label))
      .toEqual(['Male', 'Female', 'Gender diverse']);
  });

  it('seeds titles and relationship statuses with what a form asks for', () => {
    expect(parseVocabulary(TITLE_VOCAB.defaults).map((t) => t.key))
      .toEqual(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof']);
    expect(parseVocabulary(RELATIONSHIP_STATUS_VOCAB.defaults).map((t) => t.label))
      .toContain('De facto');
    // Separated is not divorced, and it is the answer that most often changes
    // what can be applied for.
    expect(parseVocabulary(RELATIONSHIP_STATUS_VOCAB.defaults).map((t) => t.label))
      .toContain('Separated');
  });
});

// ---------------------------------------------------------------------------
// The form and the page.
// ---------------------------------------------------------------------------

function mount() {
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','Thi Kim Oanh TRUONG','Thi Kim Oanh','TRUONG','active','${AT}','${AT}'),
                    ('org1','CL-0002','organisation','Acme Limited',NULL,NULL,'active','${AT}','${AT}')`);
  return h;
}

/** The form posts every box, so a partial post would blank the rest. */
const personForm = (over: Record<string, string> = {}) => ({
  kind: 'individual', given_names: 'Thi Kim Oanh', family_name: 'TRUONG',
  status: 'active', ...over,
});

const filled = {
  title: 'ms', gender: 'female', relationship_status: 'de_facto',
  other_names: 'Oanh TRUONG-SMITH until 2019',
  birth_country: 'VN', birth_region: 'Nghe An', birth_town: 'Vinh',
  national_id_number: '079203001234', national_id_country: 'VN',
};

describe('the fields save from the form and appear on the page', () => {
  it('saves every one of them', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', personForm(filled));
    expect(res.status).toBe(303);
    const row = h.get<Record<string, string | null>>(
      `SELECT title, gender, relationship_status, other_names,
              birth_country, birth_region, birth_town,
              national_id_number, national_id_country FROM clients WHERE id = ?`, 'cl1')!;
    expect(row).toEqual(filled);
  });

  it('shows them on the client page where a reader expects them', async () => {
    const h = mount();
    await h.post('/clients/cl1', personForm(filled));
    const body = await (await h.request('/clients/cl1')).text();
    // Labels, not stored keys: "de_facto" on a client page is the register
    // talking to itself.
    expect(body).toContain('Ms');
    expect(body).toContain('De facto');
    expect(body).toContain('Female');
    // The place of birth reads outwards, the way it is said aloud.
    expect(body).toContain('Vinh, Nghe An, Vietnam');
    expect(body).toContain('079203001234');
    expect(body).toContain('Oanh TRUONG-SMITH until 2019');
  });

  it('offers every one of them on the client form', async () => {
    const h = mount();
    const body = await (await h.request('/clients/cl1/edit')).text();
    for (const name of Object.keys(filled)) {
      expect(body, `no box for ${name}`).toContain(`name="${name}"`);
    }
  });
});

describe('a value outside the practice’s own list is refused', () => {
  for (const [box, junk] of [['gender', 'Attack Helicopter'], ['title', 'His Excellency'],
                             ['relationship_status', 'complicated']] as const) {
    it(`refuses a ${box} that is not on the list`, async () => {
      const h = mount();
      const res = await h.post('/clients/cl1', personForm({ [box]: junk }));
      // The form comes back with the message on it rather than a redirect that
      // loses what was typed, as every other vocabulary box does.
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('not one of the');
      expect(h.get<{ v: string | null }>(`SELECT ${box} v FROM clients WHERE id = ?`, 'cl1')!.v)
        .toBe(null);
    });
  }

  it('follows the list when an administrator changes it', async () => {
    // The list is the practice's, so what is refused has to move with it. A
    // narrowed list refuses what it no longer carries; a widened one accepts.
    const h = mount();
    h.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('vocab.genders', ?, ?)`)
      .run('male | Male\nfemale | Female\nnonbinary | Non-binary', AT);
    expect((await h.post('/clients/cl1', personForm({ gender: 'gender_diverse' }))).status).toBe(400);
    expect((await h.post('/clients/cl1', personForm({ gender: 'nonbinary' }))).status).toBe(303);
    expect(h.get<{ v: string }>('SELECT gender v FROM clients WHERE id = ?', 'cl1')!.v)
      .toBe('nonbinary');
  });

  it('refuses half a national identity number, and says which box', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', personForm({ national_id_number: '079203001234' }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('Say which country issued');
    expect(h.get<{ v: string | null }>('SELECT national_id_number v FROM clients WHERE id = ?', 'cl1')!.v)
      .toBe(null);

    const other = await h.post('/clients/cl1', personForm({ national_id_country: 'VN' }));
    expect(other.status).toBe(400);
    expect(await other.text()).toContain('Enter the national identity number');
  });
});

describe('none of this applies to a company', () => {
  it('keeps every one of them inside a block the server hides for a company', async () => {
    // Server-side `hidden`, not merely hidden by the script: a company has no
    // gender and no birthplace, and the wrong half of this form should never be
    // on the page — with scripting or without it.
    const h = mount();
    const body = await (await h.request('/clients/org1/edit')).text();

    // The blocks that carry them, read out of the rendered page by their own
    // opening tags rather than assumed. Each must be marked hidden for this
    // record, and each new box must be inside one of them.
    const blocks: Array<[string, string]> = [
      ...['title', 'other_names', 'gender', 'relationship_status',
          'birth_country', 'birth_region', 'birth_town']
        .map((name): [string, string] => [name, 'data-kind="individual"']),
      ...['national_id_number', 'national_id_country']
        .map((name): [string, string] => [name, 'data-panel="identity"']),
    ];

    for (const [name, opener] of blocks) {
      const start = body.indexOf(opener);
      expect(start, `no ${opener} block on the page`).toBeGreaterThan(-1);
      const openTag = body.slice(body.lastIndexOf('<div', start), body.indexOf('>', start) + 1);
      expect(openTag, `${opener} is not hidden for a company`).toContain('hidden');
      // The box is after that block opens and before the company half begins.
      const box = body.indexOf(`name="${name}"`);
      expect(box, `no box for ${name}`).toBeGreaterThan(start);
    }
    // And the company half really is a separate block, so "after the individual
    // one opens" is not the whole page.
    expect(body).toContain('data-kind="organisation"');
  });

  it('shows none of them on a company’s page', async () => {
    const h = mount();
    const body = await (await h.request('/clients/org1')).text();
    for (const label of ['Place of birth', 'Relationship status', 'National ID', 'Other names used']) {
      expect(body, `${label} shown for a company`).not.toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// What a document reading may do with them.
// ---------------------------------------------------------------------------

const client = (over: Partial<ClientFacts> = {}): ClientFacts => ({
  id: 'cl1', ref: 'CL-0001', full_name: 'Thi Kim Oanh TRUONG', kind: 'individual',
  given_names: 'Thi Kim Oanh', family_name: 'TRUONG', preferred_name: null,
  email: null, phone: null, address: null, date_of_birth: null,
  current_visa_type: null, current_visa_expiry: null, nzbn: null, inz_client_number: null,
  title: null, gender: null, relationship_status: null, other_names: null,
  birth_country: null, birth_region: null, birth_town: null,
  national_id_number: null, national_id_country: null, ...over,
});

const kase = {
  id: 'k1', ref: 'CS-0001', descriptor: 'x', inz_application_number: null,
  lodged_at: null, decision_due_at: null, next_action: null, summary: 'x',
};

function reading(person: Record<string, unknown>) {
  return normaliseIntake({
    applicant: {
      kind: 'individual', given_names: 'Thi Kim Oanh', family_name: 'TRUONG', ...person,
    } as never,
    other_parties: [], summary: 's', file_note: 'n', missing: [],
  });
}

const plan = (person: Record<string, unknown>, facts: Partial<ClientFacts> = {}) => planReading({
  reading: reading(person), kase, client: client(facts), heldNationalities: [],
  visaTerms: [], titleTerms: parseVocabulary(TITLE_VOCAB.defaults),
  genderTerms: parseVocabulary(GENDER_VOCAB.defaults),
  relationshipTerms: parseVocabulary(RELATIONSHIP_STATUS_VOCAB.defaults),
});

describe('a reading offers these boxes and never writes over one', () => {
  it('offers an empty box, with the value it would store', () => {
    const p = plan({ gender: 'Female', title: 'Ms', relationship_status: 'De facto',
                     birth_country: 'Vietnam', birth_town: 'Vinh', birth_region: 'Nghe An',
                     other_names: 'Oanh TRUONG-SMITH' });
    const offered = Object.fromEntries(p.clientFill.map((x) => [x.column, x.proposed]));
    expect(offered.gender).toBe('female');
    expect(offered.title).toBe('ms');
    expect(offered.relationship_status).toBe('de_facto');
    expect(offered.birth_country).toBe('VN');
    expect(offered.birth_town).toBe('Vinh');
    expect(offered.other_names).toBe('Oanh TRUONG-SMITH');
    // The screen shows the label, not the key it would store.
    expect(p.clientFill.find((x) => x.column === 'gender')!.proposedShown).toBe('Female');
    expect(p.clientFill.find((x) => x.column === 'birth_country')!.proposedShown).toBe('Vietnam');
  });

  it('never offers a box the record already answers', () => {
    const p = plan({ gender: 'Male', birth_town: 'Hanoi' },
                   { gender: 'female', birth_town: 'Vinh' });
    expect(p.clientFill.map((x) => x.column)).not.toContain('gender');
    expect(p.clientFill.map((x) => x.column)).not.toContain('birth_town');
    // Shown and kept, so somebody reading the file can see the document
    // disagreed and decide.
    expect(p.clientHeld.map((x) => x.column)).toEqual(
      expect.arrayContaining(['gender', 'birth_town']));
  });

  it('reports a vocabulary value the practice’s list does not carry', () => {
    // The same answer the reading already gives for a visa type: not written
    // into the column as its own raw words, reported instead, which is the
    // register learning that its list has a gap.
    const p = plan({ gender: 'Non-binary' });
    expect(p.clientFill.map((x) => x.column)).not.toContain('gender');
    expect(p.unplaceable.join(' ')).toContain('A gender the practice’s own list does not carry'
      .replace('’', "'"));
    expect(p.unplaceable.join(' ')).toContain('Non-binary');
  });

  it('offers a national identity number only with the country that issued it', () => {
    const both = plan({ national_id_number: '079203001234', national_id_country: 'Vietnam' });
    const one = both.clientFill.find((x) => x.column === 'national_id_number')!;
    expect(one.proposedShown).toBe('079203001234 · Vietnam');
    // One tick for the pair. Two would let somebody approve the number and not
    // its country, and the press would abort against the trigger.
    expect(both.clientFill.filter((x) => x.column.startsWith('national_id'))).toHaveLength(1);

    const half = plan({ national_id_number: '079203001234' });
    expect(half.clientFill.map((x) => x.column)).not.toContain('national_id_number');
    expect(half.unplaceable.join(' ')).toContain('with no country named for it');
  });

  it('writes nothing about a company', () => {
    const p = plan({ kind: 'organisation', family_name: 'Acme Limited', gender: 'Male',
                     birth_town: 'Vinh', national_id_number: '1', national_id_country: 'Vietnam' },
                   { kind: 'organisation', full_name: 'Acme Limited', family_name: 'Acme Limited',
                     given_names: null });
    for (const column of ['gender', 'birth_town', 'national_id_number']) {
      expect(p.clientFill.map((x) => x.column)).not.toContain(column);
    }
  });
});

describe('the merge itself fills only what is empty', () => {
  it('fills an empty box and leaves a filled one alone', async () => {
    const h = mount();
    h.db.prepare("UPDATE clients SET gender = 'female' WHERE id = 'cl1'").run();
    await fillEmptyClientFields(h.env as never, 'cl1', {
      gender: 'male', birth_town: 'Vinh', birth_country: 'VN',
    });
    const row = h.get<Record<string, string | null>>(
      'SELECT gender, birth_town, birth_country FROM clients WHERE id = ?', 'cl1')!;
    expect(row).toEqual({ gender: 'female', birth_town: 'Vinh', birth_country: 'VN' });
  });

  it('writes both halves of a national identity number in one statement', async () => {
    const h = mount();
    expect(await setNationalIdentity(h.env as never, 'cl1', '079203001234', 'VN')).toBe(true);
    const row = h.get<Record<string, string | null>>(
      'SELECT national_id_number n, national_id_country c FROM clients WHERE id = ?', 'cl1')!;
    expect(row).toEqual({ n: '079203001234', c: 'VN' });
  });

  it('leaves a national identity number already recorded exactly as it is', async () => {
    const h = mount();
    await setNationalIdentity(h.env as never, 'cl1', '079203001234', 'VN');
    expect(await setNationalIdentity(h.env as never, 'cl1', '999999999999', 'TH')).toBe(false);
    const row = h.get<Record<string, string | null>>(
      'SELECT national_id_number n, national_id_country c FROM clients WHERE id = ?', 'cl1')!;
    expect(row).toEqual({ n: '079203001234', c: 'VN' });
  });

  it('refuses to write half of one, however it is called', async () => {
    const h = mount();
    expect(await setNationalIdentity(h.env as never, 'cl1', '079203001234', null)).toBe(false);
    expect(await setNationalIdentity(h.env as never, 'cl1', null, 'VN')).toBe(false);
    expect(h.get<{ n: string | null }>('SELECT national_id_number n FROM clients WHERE id = ?', 'cl1')!.n)
      .toBe(null);
  });
});
