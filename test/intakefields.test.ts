/**
 * What the reading is allowed to write down.
 *
 * Reported on 31 August 2026 from a real partnership file. The document said
 * the supporting partner is a national of Vietnam and of New Zealand, that the
 * applicant is on a visa expiring in May 2028, and three paragraphs about two
 * previous marriages, a child in Vietnam, an address and an assault reported to
 * Police. The reading found all of it. The form had nowhere to put any of it,
 * so it was read once, shown on a screen, and lost at the last step.
 *
 * Three rules are pinned here: the boxes exist, what is typed in them is
 * saved, and the summary survives as a file note rather than only as an
 * editable field on the matter.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { assistantModule } from '../src/modules/assistant';
import { inquiriesModule } from '../src/modules/inquiries';

const AT = '2026-08-31T00:00:00Z';
const USER = fakeUser();
const RUN = 'air_test_0001';

/** The whole of what a reading carries, as the model would return it. */
const READING = {
  applicant: {
    given_names: 'Minh Duc', family_name: 'TRAN', preferred_name: null,
    email: null, phone: null, nationalities: ['VN'],
    current_visa_type: null, current_visa_expiry: '2028-05-22',
    occupation: 'Painter', date_of_birth: '1991-11-29', role: 'principal_applicant',
  },
  other_parties: [{
    given_names: 'Bich Ha', family_name: 'PHAM', preferred_name: null,
    email: null, phone: null, nationalities: ['VN', 'NZ'],
    current_visa_type: null, current_visa_expiry: null,
    occupation: 'Packing factory worker', date_of_birth: '1987-04-18', role: 'supporting_partner',
  }],
  case_type: null, suggested_title: 'Partnership information',
  inz_client_number: null, inz_application_number: null,
  lodged_on: null, decision_due_on: null,
  summary: 'Two previous marriages, a child living overseas, and the address they share.',
  missing: [],
};

function seed(h: any) {
  h.db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?)`,
  ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.prepare(
    `INSERT INTO ai_runs (id, kind, provider, model, status, input_hash, output_json,
                          latency_ms, created_at)
     VALUES (?, 'intake', 'test', 'test', 'ok', 'x', ?, 1, ?)`,
  ).run(RUN, JSON.stringify(READING), AT);
}

const mount = () => mountModule(assistantModule, { user: USER });
const rows = (h: any, sql: string, ...p: unknown[]) => h.db.prepare(sql).all(...p);

describe('the boxes on the check-it form', () => {
  it('offers a visa and a second nationality for everybody named', async () => {
    const h = mount();
    seed(h);
    const body = await (await h.request(`/assistant/intake?run=${RUN}`)).text();
    for (const name of [
      'a_nationality', 'a_nationality_2', 'a_current_visa_type', 'a_current_visa_expiry',
      'p0_nationality', 'p0_nationality_2', 'p0_current_visa_type', 'p0_current_visa_expiry',
    ]) {
      expect(body, `no box named ${name}`).toContain(`name="${name}"`);
    }
  });

  it('offers one more box than the reading found, so a third can be added', async () => {
    // The partner holds two. A form that stops at what was found can never
    // record what it missed.
    const h = mount();
    seed(h);
    const body = await (await h.request(`/assistant/intake?run=${RUN}`)).text();
    expect(body).toContain('name="p0_nationality_3"');
    expect(body).not.toContain('name="p0_nationality_4"');
    // The applicant holds one, so two boxes: theirs and a spare.
    expect(body).toContain('name="a_nationality_2"');
    expect(body).not.toContain('name="a_nationality_3"');
  });
});

describe('opening the matter', () => {
  const apply = (h: any, extra: Record<string, string> = {}) => h.post('/assistant/intake/apply', {
    run: RUN,
    a_given_names: 'Minh Duc', a_family_name: 'TRAN',
    a_nationality: 'VN', a_current_visa_expiry: '2028-05-22',
    descriptor: 'Partnership information', case_type: 'wv_aewv', status: 'engaged',
    // A matter must be assigned to somebody — the database says so.
    assigned_to: USER.id,
    summary: READING.summary,
    party_count: '1',
    p0_create: 'on', p0_given_names: 'Bich Ha', p0_family_name: 'PHAM',
    p0_nationality: 'VN', p0_nationality_2: 'NZ', p0_role: 'supporting_partner',
    ...extra,
  });

  it('keeps both of a dual national’s nationalities', async () => {
    const h = mount();
    seed(h);
    await apply(h);
    const partner = rows(h, "SELECT id FROM clients WHERE family_name = 'PHAM'")[0] as any;
    const held = rows(h,
      'SELECT code FROM client_nationalities WHERE client_id = ? ORDER BY position', partner.id);
    expect((held as any[]).map((r) => r.code)).toEqual(['VN', 'NZ']);
  });

  it('keeps the visa the document gave', async () => {
    const h = mount();
    seed(h);
    await apply(h);
    const client = rows(h, "SELECT current_visa_expiry FROM clients WHERE family_name = 'TRAN'")[0] as any;
    expect(client.current_visa_expiry).toBe('2028-05-22');
  });

  it('writes the summary as a file note, not only as a field', async () => {
    // A file note is the record of what a document said on the day it arrived,
    // and file notes are append-only. The matter's summary is a working
    // description somebody edits. They are not the same thing.
    const h = mount();
    seed(h);
    await apply(h);
    const notes = rows(h,
      "SELECT body FROM entries WHERE entity_type = 'case' AND kind = 'note'") as any[];
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain(READING.summary);
    expect(notes[0].body).toContain('read by the assistant');
  });

  it('names the matter by what it is about, and derives the title from it', async () => {
    // This form was still asking for a title after the rest of the register
    // stopped, so a matter opened from a document arrived with no description
    // at all — found on the live register on 1 September 2026, one matter in.
    const h = mount();
    seed(h);
    await apply(h);
    const kase = (rows(h, 'SELECT title, descriptor FROM cases')[0] as any);
    expect(kase.descriptor).toBe('Partnership information');
    expect(kase.title).toBe(kase.descriptor);
  });

  it('writes no note when there is nothing to say', async () => {
    const h = mount();
    seed(h);
    await apply(h, { summary: '' });
    const notes = rows(h,
      "SELECT body FROM entries WHERE entity_type = 'case' AND kind = 'note'") as any[];
    expect(notes).toHaveLength(0);
  });
});


/**
 * The three places a matter can be created must agree about its name.
 *
 * Migration 0049 made the description the name of a matter and took the title
 * field off the matter form. The other two creators were missed — the assistant
 * intake form, found on the live register with one matter already written that
 * way, and the inquiry conversion, found in review on the same branch. A rule
 * changed in one of three places is a rule that does not hold.
 */
describe('converting an inquiry to a matter', () => {
  const mount = () => mountModule(inquiriesModule, { user: USER });
  const seedInquiry = (h: any) => {
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
                  VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.prepare(`INSERT INTO inquiries (id, ref, source, subject, body, contact_name,
                                         contact_email, status, received_at, created_at, updated_at)
                  VALUES ('inq1','INQ-1','web','A subject','A body','A PERSON','a@b.c','new',?,?,?)`)
      .run(AT, AT, AT);
  };
  const convert = (h: any) => h.post('/inquiries/inq1/convert', {
    kind: 'individual', family_name: 'TESTER', given_names: 'A',
    descriptor: 'Partner of a New Zealand citizen, living together since 2024',
    case_type: 'wv_aewv', assigned_to: USER.id, nationality: 'NZ',
  });

  it('names the matter by what it is about, and derives the title from it', async () => {
    const h = mount();
    seedInquiry(h);
    await convert(h);
    const kase = (h.db.prepare('SELECT title, descriptor FROM cases').all() as any[])[0];
    expect(kase.descriptor).toBe('Partner of a New Zealand citizen, living together since 2024');
    expect(kase.title).toBe(kase.descriptor);
  });

  it('writes the nationality to the table, not to a column that no longer exists', async () => {
    // The column went in migration 0050. A writer missed by that change would
    // now fail loudly, but a *reader* missed by it would quietly show nothing,
    // so this pins the write.
    const h = mount();
    seedInquiry(h);
    await convert(h);
    const held = h.db.prepare('SELECT code FROM client_nationalities').all() as any[];
    expect(held.map((r: any) => r.code)).toEqual(['NZ']);
  });
});
