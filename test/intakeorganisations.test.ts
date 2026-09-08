/**
 * A company read out of a document is created as a company.
 *
 * Reported by the practice on 8 September 2026, after opening a matter from a
 * Peak Seasonal Work Visa file: *"I cannot even ensure that the employer
 * company IS A COMPANY and not an individual — how come??"*
 *
 * Because every party the assistant proposed was created as an individual. The
 * word was hard-coded. So LAND MEAT NEW ZEALAND LIMITED arrived on the register
 * as a person with a very long family name, no way to say otherwise on the
 * form, and the only remedy was to notice afterwards and edit the record —
 * which is exactly what the practice had to do.
 *
 * The second half of the same report: *"for a company I need a contact person's
 * name as well, or at least be able to link a name from clients/contacts."*
 * Those columns have existed since migration 0008 — `organisation_id`, the role
 * held there, and `primary_contact_id`, "who do I ring at this company" — and
 * none of them was reachable from this form.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { assistantModule } from '../src/modules/assistant';
import { normaliseIntake } from '../src/ai/provider';
import { matchExisting } from '../src/modules/assistant/intake';

const AT = '2026-09-08T09:00:00Z';
const USER = fakeUser();

function seeded() {
  const h = mountModule(assistantModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO settings (key,value,updated_at)
             VALUES ('vocab.case_types','wv_seasonal | WV. Seasonal','${AT}')`);
  return h;
}

/** The apply form, as the review page posts it. */
const applyForm = (over: Record<string, string> = {}) => ({
  descriptor: 'Peak Seasonal Work Visa for a meat process worker',
  case_type: 'wv_seasonal',
  status: 'engaged',
  assigned_to: USER.id,
  a_kind: 'individual',
  a_given_names: 'THI NGOC ANH',
  a_family_name: 'LE',
  party_count: '2',
  // The employer.
  p0_create: '1',
  p0_kind: 'organisation',
  p0_family_name: 'Land Meat New Zealand Limited',
  p0_role: 'employer',
  // The employer's immigration manager.
  p1_create: '1',
  p1_kind: 'individual',
  p1_given_names: 'James',
  p1_family_name: 'McFarlane',
  p1_role: 'agent',
  ...over,
});

const rowFor = (h: ReturnType<typeof seeded>, name: string) =>
  h.get<{ id: string; kind: string; full_name: string; given_names: string | null;
          date_of_birth: string | null; organisation_id: string | null;
          organisation_role: string | null; primary_contact_id: string | null }>(
    'SELECT id, kind, full_name, given_names, date_of_birth, organisation_id, organisation_role, '
    + 'primary_contact_id FROM clients WHERE full_name LIKE ?', `%${name}%`);

describe('an employer named in a document', () => {
  it('is created as a company, not as a person with a long surname', async () => {
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm());
    const employer = rowFor(h, 'LAND MEAT')!;
    expect(employer.kind).toBe('organisation');
    // As typed, not shouted: a company's registered name is copied from the
    // register that holds it and is not the practice's to restyle. The stored
    // family name is still capitalised, like every other, which is what the
    // client form does — the two routes have to make the same shape of company.
    expect(employer.full_name).toBe('Land Meat New Zealand Limited');
  });

  it('is still a person when the form says a person', async () => {
    // The control has to work both ways, or it is a rename of the bug.
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm({ p0_kind: 'individual',
      p0_given_names: 'Land', p0_family_name: 'Meat' }));
    expect(rowFor(h, 'MEAT')!.kind).toBe('individual');
  });

  it('is given no birthday, nationality or visa, whatever the form carried', async () => {
    // The boxes are on the form for everybody. A company holding a visa is a
    // fact about a legal entity that is not true of it.
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm({
      p0_date_of_birth: '1990-01-01', p0_current_visa_type: 'aewv',
      p0_current_visa_expiry: '2027-01-01', p0_nationality_1: 'NZ',
    }));
    const employer = rowFor(h, 'LAND MEAT')!;
    expect(employer.date_of_birth).toBeNull();
    expect(employer.given_names).toBeNull();
    expect(h.count(
      'SELECT COUNT(*) AS n FROM client_nationalities WHERE client_id = ?', employer.id)).toBe(0);
  });
});

describe('who to ring at the company', () => {
  it('records the contact on the company, and the employer on the person', async () => {
    // Both directions, from one choice: the practice asked to link a name to a
    // company, and a link that only pointed one way would leave the other page
    // silent about it.
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm({ p0_organisation_id: 'p1' }));
    const employer = rowFor(h, 'LAND MEAT')!;
    const manager = rowFor(h, 'MCFARLANE')!;
    expect(employer.primary_contact_id).toBe(manager.id);
    expect(manager.organisation_id).toBe(employer.id);
  });

  it('records what the person does there when the person names the company', async () => {
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm({
      p1_organisation_id: 'p0', p1_organisation_role: 'Immigration Manager' }));
    const manager = rowFor(h, 'MCFARLANE')!;
    expect(manager.organisation_id).toBe(rowFor(h, 'LAND MEAT')!.id);
    expect(manager.organisation_role).toBe('Immigration Manager');
  });

  it('links to a company already on the register', async () => {
    // "Or at least be able to link a name from clients/contacts."
    const h = seeded();
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('org1','CL-0025','organisation','AFFCO NEW ZEALAND LIMITED','active','${AT}','${AT}')`);
    await h.post('/assistant/intake/apply', applyForm({ p1_organisation_id: 'org1' }));
    expect(rowFor(h, 'MCFARLANE')!.organisation_id).toBe('org1');
  });

  it('ignores a link to a record that no longer exists', async () => {
    // The review page can sit open while somebody else archives a client.
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm({ p1_organisation_id: 'cli_gone' }));
    expect(rowFor(h, 'MCFARLANE')!.organisation_id).toBeNull();
  });

  it('ignores a link to somebody who was not ticked', async () => {
    // An unticked box is absent from the submission, not empty in it.
    const h = seeded();
    const { p1_create: _dropped, ...withoutTheManager } = applyForm({ p0_organisation_id: 'p1' });
    await h.post('/assistant/intake/apply', withoutTheManager);
    expect(rowFor(h, 'LAND MEAT')!.primary_contact_id).toBeNull();
    expect(rowFor(h, 'MCFARLANE'), 'somebody unticked was created anyway').toBeNull();
  });

  it('does not link somebody to themselves', async () => {
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm({ p0_organisation_id: 'p0' }));
    expect(rowFor(h, 'LAND MEAT')!.primary_contact_id).toBeNull();
  });

  it('leaves an employer the person already has alone', async () => {
    // The company's contact plainly works there, so the reverse link is filled
    // in — but never over the top of one already recorded.
    const h = seeded();
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('org1','CL-0025','organisation','ANOTHER EMPLOYER LIMITED','active','${AT}','${AT}')`);
    await h.post('/assistant/intake/apply', applyForm({
      p1_organisation_id: 'org1', p0_organisation_id: 'p1' }));
    expect(rowFor(h, 'MCFARLANE')!.organisation_id,
      'an employer already recorded was overwritten').toBe('org1');
    expect(rowFor(h, 'LAND MEAT')!.primary_contact_id).toBe(rowFor(h, 'MCFARLANE')!.id);
  });
});

describe('the matter opened this way', () => {
  it('is named the way every other matter is named', async () => {
    // This route wrote the description into the name as well, and carried a
    // comment saying that was "written from one place". It was not: the New
    // matter form was the other place, corrected on 8 September, and this one
    // was missed.
    const h = seeded();
    await h.post('/assistant/intake/apply', applyForm());
    const row = h.get<{ title: string; descriptor: string }>('SELECT title, descriptor FROM cases')!;
    expect(row.title).toBe('WV. Seasonal — Thi Ngoc Anh LE');
    expect(row.descriptor).toBe('Peak Seasonal Work Visa for a meat process worker');
    expect(row.title === row.descriptor).toBe(false);
  });
});

describe('what the reading itself proposes', () => {
  it('carries whether each party is a person or a company', () => {
    const read = normaliseIntake({
      applicant: { kind: 'individual', family_name: 'LE' },
      other_parties: [{ kind: 'organisation', family_name: 'Land Meat New Zealand Limited' }],
    } as never);
    expect(read.applicant.kind).toBe('individual');
    expect(read.other_parties[0]!.kind).toBe('organisation');
  });

  it('treats anything unexpected as a person', () => {
    // A reading that produced something odd must not quietly turn a client
    // into a company.
    const read = normaliseIntake({
      applicant: { kind: 'company', family_name: 'LE' }, other_parties: [],
    } as never);
    expect(read.applicant.kind).toBe('individual');
  });
});

/**
 * The same company, read twice.
 *
 * Reported on 8 September 2026 with a screenshot of the client list showing
 * CL-0257 and CL-0259, both LAND MEAT NEW ZEALAND LIMITED, forty minutes apart:
 * *"the assistant just created a duplicate organisation. Does it check if it
 * already exists??? Same needs to be true for clients so as to avoid
 * duplication."*
 *
 * It did not check, for two separate reasons, and both are here:
 *
 *  - **A company could never match.** The name test wanted a given name and a
 *    family name to agree, and a company has one name in one field.
 *  - **Only the applicant was ever looked for.** Every other party a reading
 *    named — the employer, the partner, the adviser — was created afresh, on
 *    every reading, however many times they were already on the register.
 */
describe('somebody the reading names who is already on the register', () => {
  const seededWith = (rows: string) => {
    const h = seeded();
    h.db.exec(rows);
    return h;
  };

  it('is offered as a choice rather than created again — a company', async () => {
    const h = seededWith(`INSERT INTO clients (id,ref,kind,full_name,family_name,status,created_at,updated_at)
      VALUES ('org1','CL-0257','organisation','LAND MEAT NEW ZEALAND LIMITED',
              'LAND MEAT NEW ZEALAND LIMITED','active','${AT}','${AT}')`);
    const run = h.get<{ id: string }>('SELECT 1 AS id');
    expect(run).toBeTruthy();
    const matched = await matchExisting(h.env as any,
      { kind: 'organisation', family_name: 'Land Meat New Zealand Limited' } as never);
    expect(matched?.ref, 'a company read twice is a second company').toBe('CL-0257');
  });

  it('is matched however the document capitalised it', async () => {
    const h = seededWith(`INSERT INTO clients (id,ref,kind,full_name,family_name,status,created_at,updated_at)
      VALUES ('org1','CL-0257','organisation','Land Meat New Zealand Limited',
              'LAND MEAT NEW ZEALAND LIMITED','active','${AT}','${AT}')`);
    expect((await matchExisting(h.env as any,
      { kind: 'organisation', family_name: 'LAND MEAT NEW ZEALAND LIMITED' } as never))?.ref)
      .toBe('CL-0257');
  });

  it('is not matched to a person who happens to share the name', async () => {
    // A company's whole name matching is the same company. A person's is not.
    const h = seededWith(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
      VALUES ('cl9','CL-0300','individual','Land MEAT','Land','MEAT','active','${AT}','${AT}')`);
    expect(await matchExisting(h.env as any,
      { kind: 'organisation', family_name: 'Land Meat' } as never)).toBeNull();
  });

  it('is left alone when it has been archived', async () => {
    const h = seededWith(`INSERT INTO clients (id,ref,kind,full_name,family_name,status,created_at,updated_at)
      VALUES ('org1','CL-0257','organisation','LAND MEAT NEW ZEALAND LIMITED',
              'LAND MEAT NEW ZEALAND LIMITED','archived','${AT}','${AT}')`);
    expect(await matchExisting(h.env as any,
      { kind: 'organisation', family_name: 'LAND MEAT NEW ZEALAND LIMITED' } as never)).toBeNull();
  });

  it('is linked to the matter instead of duplicated, when the choice is kept', async () => {
    const h = seededWith(`INSERT INTO clients (id,ref,kind,full_name,family_name,status,created_at,updated_at)
      VALUES ('org1','CL-0257','organisation','LAND MEAT NEW ZEALAND LIMITED',
              'LAND MEAT NEW ZEALAND LIMITED','active','${AT}','${AT}')`);
    await h.post('/assistant/intake/apply', applyForm({ p0_existing_client_id: 'org1' }));

    expect(h.count(`SELECT COUNT(*) AS n FROM clients WHERE full_name LIKE '%LAND MEAT%'`),
      'the company was created a second time').toBe(1);
    const caseId = h.get<{ id: string }>('SELECT id FROM cases')!.id;
    expect(h.count(
      'SELECT COUNT(*) AS n FROM case_parties WHERE case_id = ? AND client_id = ?',
      caseId, 'org1')).toBe(1);
  });

  it('is still created when the choice is refused', async () => {
    // The page offers; the person decides. "Create a new record" has to work.
    const h = seededWith(`INSERT INTO clients (id,ref,kind,full_name,family_name,status,created_at,updated_at)
      VALUES ('org1','CL-0257','organisation','LAND MEAT NEW ZEALAND LIMITED',
              'LAND MEAT NEW ZEALAND LIMITED','active','${AT}','${AT}')`);
    await h.post('/assistant/intake/apply', applyForm({ p0_existing_client_id: '' }));
    expect(h.count(`SELECT COUNT(*) AS n FROM clients WHERE full_name LIKE '%LAND MEAT%'`)).toBe(2);
  });

  it('does not fail the whole press when the same person is named twice', async () => {
    // One row per client per matter — the database refuses a second, and a
    // reading that named somebody twice would have taken the matter with it.
    const h = seededWith(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
      VALUES ('p9','CL-0400','individual','James MCFARLANE','James','MCFARLANE','active','${AT}','${AT}')`);
    const res = await h.post('/assistant/intake/apply', applyForm({
      p0_existing_client_id: 'p9', p1_existing_client_id: 'p9' }));
    expect(res.status).toBe(303);
    const caseId = h.get<{ id: string }>('SELECT id FROM cases')!.id;
    expect(h.count('SELECT COUNT(*) AS n FROM case_parties WHERE case_id = ? AND client_id = ?',
      caseId, 'p9')).toBe(1);
  });

  it('does not link the applicant to their own matter twice', async () => {
    const h = seeded();
    h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
               VALUES ('cl9','CL-0500','individual','Thi Ngoc Anh LE','Thi Ngoc Anh','LE','active','${AT}','${AT}')`);
    const res = await h.post('/assistant/intake/apply', applyForm({
      existing_client_id: 'cl9', p0_existing_client_id: 'cl9' }));
    expect(res.status).toBe(303);
    const caseId = h.get<{ id: string }>('SELECT id FROM cases')!.id;
    expect(h.count('SELECT COUNT(*) AS n FROM case_parties WHERE case_id = ? AND client_id = ?',
      caseId, 'cl9')).toBe(1);
  });
});
