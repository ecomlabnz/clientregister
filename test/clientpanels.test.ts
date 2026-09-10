/**
 * The right-hand column of a client's page, in the order it is read.
 *
 * Asked for on 10 September 2026: *"see what details you can add or rearrange
 * on the actual client page — on the right side panels — to make it more
 * efficient."*
 *
 * Three judgements, each pinned below as a rule rather than as an appearance:
 *
 * 1. **Identity and compliance leads.** The dates that expire — visa, passport,
 *    police certificate, medical — are why the file is open. Money and contact
 *    details follow.
 * 2. **The INZ client number leads that card.** It is quoted on everything sent
 *    to INZ about this person. The note beside it already claimed it came
 *    first; the order never did.
 * 3. **Contact reaches them first.** Three rows of name parts used to stand
 *    between the reader and the phone number, on a page whose heading says the
 *    name in full. The parts stay — an INZ form asks for them separately — but
 *    below.
 *
 * And one addition: the age beside the date of birth, because half the
 * thresholds in the instructions are ages and working one out in the head, on a
 * page being read for something else, is where a mistake gets made.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { ageYears } from '../src/ui/format';

const AT = '2026-09-10T09:00:00Z';
const USER = fakeUser();

function mount(extra: Record<string, string | null> = {}) {
  // `??` would not do: passing null here means "recorded as nothing", which is
  // exactly the case a default would hide.
  const pick = (key: string, fallback: string) => (key in extra ? extra[key] : fallback);
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.prepare(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,
                                     email,phone,date_of_birth,inz_client_number,
                                     status,created_at,updated_at)
                VALUES ('cl1','CL-0001','individual','Sample Person','Sample','PERSON',?,?,?,?,'active',?,?)`)
    .run(pick('email', 'sample@example.test'), pick('phone', '+64 21 555 0100'),
         pick('date_of_birth', '1990-06-15'), pick('inz_client_number', '12345678'), AT, AT);
  return h;
}

const sideColumn = async (h: ReturnType<typeof mount>) => {
  const body = await (await h.request('/clients/cl1')).text();
  const i = body.indexOf('col-side');
  expect(i, 'the side column is on the page').toBeGreaterThan(-1);
  return body.slice(i);
};

describe('the order of the panels', () => {
  it('leads with Identity and compliance, then Contact', async () => {
    const side = await sideColumn(mount());
    expect(side.indexOf('Identity and compliance')).toBeLessThan(side.indexOf('>Contact<'));
  });

  it('leaves Tags at the end, as on a matter', async () => {
    const side = await sideColumn(mount());
    for (const heading of ['Identity and compliance', '>Contact<', 'Open tasks', '>Notes<']) {
      expect(side.indexOf(heading), heading).toBeLessThan(side.indexOf('>Tags<'));
    }
  });
});

describe('Identity and compliance', () => {
  it('leads with the INZ client number', async () => {
    const side = await sideColumn(mount());
    const card = side.slice(side.indexOf('Identity and compliance'));
    const inz = card.indexOf('INZ client no.');
    expect(inz).toBeGreaterThan(-1);
    for (const later of ['Nationality', 'Date of birth', 'Current visa', 'Police cert.']) {
      expect(inz, later).toBeLessThan(card.indexOf(later));
    }
  });

  it('shows the age beside the date of birth', async () => {
    const side = await sideColumn(mount({ date_of_birth: '1990-06-15' }));
    const row = side.slice(side.indexOf('Date of birth'), side.indexOf('Current visa'));
    expect(row).toContain(String(ageYears('1990-06-15')));
  });

  it('says nothing about age when no birthday is recorded', async () => {
    const side = await sideColumn(mount({ date_of_birth: null }));
    const row = side.slice(side.indexOf('Date of birth'), side.indexOf('Current visa'));
    expect(row).not.toContain('·');
  });
});

describe('Contact', () => {
  it('puts the ways of reaching them above the name parts', async () => {
    const side = await sideColumn(mount());
    const card = side.slice(side.indexOf('>Contact<'), side.indexOf('Given names'));
    expect(card).toContain('<dt>Phone</dt>');
    expect(card).toContain('<dt>Email</dt>');
  });

  it('makes the phone number and the email address links', async () => {
    const side = await sideColumn(mount({ phone: '+64 21 555 0100' }));
    expect(side).toContain('tel:+64 21 555 0100');
    expect(side).toContain('mailto:sample@example.test');
  });
});

describe('working out an age', () => {
  it('counts completed years, not part ones', () => {
    expect(ageYears('2000-01-01', '2026-09-10')).toBe(26);
    expect(ageYears('2000-12-31', '2026-09-10')).toBe(25);
  });

  it('turns over on the birthday itself, not the day after', () => {
    expect(ageYears('2000-09-10', '2026-09-09')).toBe(25);
    expect(ageYears('2000-09-10', '2026-09-10')).toBe(26);
  });

  it('reads a 29 February birthday as 1 March in a year without one', () => {
    // A dependent child born on 29 February turns 25 on 1 March, which is the
    // reading every age threshold in the instructions uses.
    expect(ageYears('2000-02-29', '2025-02-28')).toBe(24);
    expect(ageYears('2000-02-29', '2025-03-01')).toBe(25);
  });

  it('has no answer where there is no date, rather than guessing zero', () => {
    expect(ageYears(null)).toBeNull();
    expect(ageYears('')).toBeNull();
    expect(ageYears('not a date')).toBeNull();
  });
});
