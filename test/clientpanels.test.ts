/**
 * The right-hand column of a client's page, in the order it is read.
 *
 * Asked for on 10 September 2026: *"see what details you can add or rearrange
 * on the actual client page — on the right side panels — to make it more
 * efficient."* Rearranged again on **12 September 2026**, when the practice
 * compared it with a matter's: *"the set of panes to the right and the data is
 * not optimal under a client's profile ... maybe they should all appear under
 * Key Details? but with the name up top? say Name, Contacts, Passport details,
 * Certificate, English, and the rest."*
 *
 * So the two cards became one, grouped. What survives from the first pass:
 *
 * 1. **The INZ client number leads.** It is quoted on everything sent to INZ
 *    about this person — it now leads the Immigration group rather than the
 *    whole card.
 * 2. **The age beside the date of birth**, because half the thresholds in the
 *    instructions are ages and working one out in the head, on a page being
 *    read for something else, is where a mistake gets made.
 *
 * And one rule from that pass is **deliberately reversed**. It read: *"Contact
 * reaches them first. Three rows of name parts used to stand between the reader
 * and the phone number."* The practice has now asked for the name at the top,
 * and that is their call about their own page — the name parts are what an INZ
 * form asks for first. The phone number is one group down rather than three
 * rows down, so the complaint that produced the old rule does not return.
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
  it('leads with Key details', async () => {
    const side = await sideColumn(mount());
    for (const later of ['Open tasks', '>Notes<', '>Tags<']) {
      expect(side.indexOf('Key details'), later).toBeLessThan(side.indexOf(later));
    }
  });

  it('leaves Tags at the end, as on a matter', async () => {
    const side = await sideColumn(mount());
    for (const heading of ['Key details', 'Open tasks', '>Notes<']) {
      expect(side.indexOf(heading), heading).toBeLessThan(side.indexOf('>Tags<'));
    }
  });
});

describe('Key details', () => {
  it('leads the Immigration group with the INZ client number', async () => {
    const side = await sideColumn(mount());
    const group = side.slice(side.indexOf('>Immigration<'), side.indexOf('>Passport<'));
    const inz = group.indexOf('INZ client no.');
    expect(inz).toBeGreaterThan(-1);
    for (const later of ['Current visa', 'Visa expiry']) {
      expect(inz, later).toBeLessThan(group.indexOf(later));
    }
  });

  it('shows the age beside the date of birth', async () => {
    const side = await sideColumn(mount({ date_of_birth: '1990-06-15' }));
    const row = side.slice(side.indexOf('Date of birth'), side.indexOf('Place of birth'));
    expect(row).toContain(String(ageYears('1990-06-15')));
  });

  it('says nothing about age when no birthday is recorded', async () => {
    const side = await sideColumn(mount({ date_of_birth: null }));
    const row = side.slice(side.indexOf('Date of birth'), side.indexOf('Place of birth'));
    expect(row).not.toContain('·');
  });

  it('puts the name above the ways of reaching them', async () => {
    // The reversal of 12 September 2026. The name parts are what an INZ form
    // asks for first, and the phone number is now one group down rather than
    // three rows down.
    const side = await sideColumn(mount());
    expect(side.indexOf('>Name<')).toBeLessThan(side.indexOf('>Contact<'));
    const contact = side.slice(side.indexOf('>Contact<'), side.indexOf('>Immigration<'));
    expect(contact).toContain('<dt>Phone</dt>');
    expect(contact).toContain('<dt>Email</dt>');
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
