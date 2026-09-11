/**
 * A refusal from the database reaches the person as a sentence, not a 500.
 *
 * **Reported 12 September 2026**, filling in a client's details: *"was working
 * on client's - MANUFEKAI's details - filling in fields and this is what
 * appeared when i pressed save - annoying."* The page was *Something went
 * wrong*, with a reference number.
 *
 * The reference led to the real cause: `a visa cannot expire before it was
 * granted` — migration 0081, doing exactly its job. The client's record held an
 * expiry of 18 August 2026 and no start date, and a start date typed after it
 * made the pair contradict.
 *
 * So the database was right and nothing about it changes. What was wrong was
 * everything after: an error page, a reference number, and a form's worth of
 * typing gone.
 *
 * Two things are held here.
 *
 *  * **The pair is checked before the write**, so the message lands against the
 *    expiry box with the rest of the form still filled in — the same shape as
 *    the INZ client number and the national identity number already used.
 *  * **Any refusal that still reaches the database comes back as a sentence.**
 *    That is the net rather than the floor: the rules live in the database, the
 *    database grows rules, and the one added without a matching check here
 *    should cost somebody a sentence rather than an afternoon's typing.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule, refusalMessage } from '../src/modules/clients';

const AT = '2026-09-11T09:00:00Z';
const USER = fakeUser();

function mount() {
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  // The shape of the record that produced the report: an expiry on file and no
  // start date beside it.
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,
                                  current_visa_expiry,created_at,updated_at)
             VALUES ('cl1','CL-0901','individual','A Person','A','PERSON','active',
                     '2026-08-18','${AT}','${AT}')`);
  return h;
}

const form = (over: Record<string, string> = {}) => ({
  kind: 'individual', given_names: 'A', family_name: 'PERSON', status: 'active', ...over,
});

describe('the two visa dates, the wrong way round', () => {
  it('does not return an error page', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', form({
      current_visa_start: '2026-09-01', current_visa_expiry: '2026-08-18',
    }));
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(400);
  });

  it('says so against the expiry box', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', form({
      current_visa_start: '2026-09-01', current_visa_expiry: '2026-08-18',
    }));
    const body = await res.text();
    expect(body).toContain('A visa cannot expire before it was granted.');
  });

  it('keeps everything else that was typed', async () => {
    // The part that made it annoying rather than merely wrong.
    const h = mount();
    const res = await h.post('/clients/cl1', form({
      current_visa_start: '2026-09-01', current_visa_expiry: '2026-08-18',
      inz_client_number: '30554101',
      other_names: 'A PERSON-SMITH until 2019',
      current_visa_conditions: 'May only work for Acme Limited.',
      birth_town: 'Nukualofa',
    }));
    const body = await res.text();
    expect(body).toContain('30554101');
    expect(body).toContain('A PERSON-SMITH until 2019');
    expect(body).toContain('May only work for Acme Limited.');
    expect(body).toContain('Nukualofa');
    // And the two dates themselves, so the one to change is in front of them.
    expect(body).toContain('2026-09-01');
    expect(body).toContain('2026-08-18');
  });

  it('writes nothing', async () => {
    const h = mount();
    await h.post('/clients/cl1', form({
      current_visa_start: '2026-09-01', current_visa_expiry: '2026-08-18',
    }));
    const row = h.get<{ current_visa_start: string | null }>(
      'SELECT current_visa_start FROM clients WHERE id = ?', 'cl1')!;
    expect(row.current_visa_start).toBe(null);
  });

  it('saves the same dates the right way round', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', form({
      current_visa_start: '2026-08-18', current_visa_expiry: '2027-08-18',
    }));
    expect(res.status).toBe(303);
    const row = h.get<{ current_visa_start: string; current_visa_expiry: string }>(
      'SELECT current_visa_start, current_visa_expiry FROM clients WHERE id = ?', 'cl1')!;
    expect(row.current_visa_start).toBe('2026-08-18');
    expect(row.current_visa_expiry).toBe('2027-08-18');
  });

  it('allows the two on the same day', async () => {
    // A visa granted and expiring on one day is odd but not contradictory, and
    // the database allows it. The form must not be stricter than the database.
    const h = mount();
    const res = await h.post('/clients/cl1', form({
      current_visa_start: '2026-08-18', current_visa_expiry: '2026-08-18',
    }));
    expect(res.status).toBe(303);
  });

  it('allows an expiry with no start, which is most of the register', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', form({ current_visa_expiry: '2027-08-18' }));
    expect(res.status).toBe(303);
  });

  it('refuses it on a client being created too', async () => {
    const h = mount();
    const res = await h.post('/clients', form({
      full_name: 'B Person',
      current_visa_start: '2026-09-01', current_visa_expiry: '2026-08-18',
    }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('A visa cannot expire before it was granted.');
    expect(h.count(`SELECT COUNT(*) AS n FROM clients WHERE id <> 'cl1'`)).toBe(0);
  });
});

describe('the net under the form', () => {
  // Tested on `refusalMessage` itself rather than by driving a refusal through
  // a route, and deliberately: **every rule the form can break today is checked
  // before the write**, so there is no honest way to reach the net through the
  // form. A test that pretended to would be passing on the form's own check.
  //
  // The net is for the rule somebody adds to the database next year without a
  // matching check here. What has to be right is the translation.

  it('takes the words out of what D1 wraps around them', () => {
    const said = refusalMessage(new Error(
      'D1_ERROR: a visa cannot expire before it was granted: SQLITE_CONSTRAINT '
      + '(extended: SQLITE_CONSTRAINT_TRIGGER)'));
    expect(said).toBe('A visa cannot expire before it was granted.');
  });

  it('is the message the practice actually saw', () => {
    // Copied from the audit log entry behind reference 83d42f79, which is what
    // produced "Something went wrong" on 12 September 2026.
    const said = refusalMessage(new Error(
      'D1_ERROR: a visa cannot expire before it was granted: SQLITE_CONSTRAINT '
      + '(extended: SQLITE_CONSTRAINT_TRIGGER)'));
    expect(said).not.toBeNull();
    expect(said).not.toContain('D1_ERROR');
    expect(said).not.toContain('SQLITE');
  });

  it('handles a refusal whose wording it cannot find', () => {
    const said = refusalMessage(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'));
    expect(said).toBeTruthy();
    expect(said).not.toContain('SQLITE');
  });

  it('leaves a real fault as a fault', () => {
    // A refusal is a thing to say; a fault is a thing to log, and the error
    // page with its reference number is right for one of those two.
    expect(refusalMessage(new Error('TypeError: cannot read x of undefined'))).toBe(null);
    expect(refusalMessage(new Error('D1_ERROR: network'))).toBe(null);
    expect(refusalMessage('something that is not an Error')).toBe(null);
  });

  it('is what the two writes fall back to', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/clients/index.ts', 'utf8');
    // Both the create and the edit, and a fault still thrown from each.
    expect([...src.matchAll(/const said = refusalMessage\(err\);/g)].length).toBe(2);
    expect([...src.matchAll(/if \(!said\) throw err;/g)].length).toBe(2);
  });
});
