/**
 * The last stretch before Skilled Migrant residence closes.
 *
 * **Asked for on 11 September 2026:** *"we could probably create an alert about
 * approaching the age of 56 - when Skilled Migrant RV application cannot be
 * filed - so maybe give an alert when the person is 53, and 54 years old - the
 * user will decide whether to advise the client or not."*
 *
 * The Skilled Migrant Category is open to a principal applicant aged 55 or
 * under when the application is made, so the door shuts on the 56th birthday.
 *
 * Most of these tests are about what the check must **not** do. It was built the
 * same week the practice found sixty-six urgent alerts nobody could act on, and
 * an alert that fires every day for three years would be a second one of those.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { CHECKS_NOT_ABOUT_A_DATE } from '../src/modules/alerts';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-11T00:00:00Z';

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  let n = 0;
  const client = (o: { dob?: string | null; visa?: string | null; status?: string; kind?: string }) => {
    const id = `c${++n}`;
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, date_of_birth, current_visa_type,
                                     status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, `CL-90${String(n).padStart(2, '0')}`, o.kind ?? 'individual', `Person ${n}`,
           o.dob ?? null, o.visa ?? 'wv_aewv', o.status ?? 'active', AT, AT);
    return id;
  };
  const fire = (today: string) =>
    (db.prepare(CHECKS_NOT_ABOUT_A_DATE.smcAgeWindow()) as any).all(today) as
      Array<{ id: string; age: number; birthday: string; closes: string }>;
  return { client, fire };
}

describe('when the row appears', () => {
  it('fires on the 53rd birthday', () => {
    const { client, fire } = register();
    client({ dob: '1973-09-11' });
    expect(fire('2026-09-11').map((r) => r.age)).toEqual([53]);
  });

  it('fires again on the 54th', () => {
    const { client, fire } = register();
    client({ dob: '1972-09-11' });
    expect(fire('2026-09-11').map((r) => r.age)).toEqual([54]);
  });

  it('names the date the door shuts', () => {
    const { client, fire } = register();
    client({ dob: '1973-09-11' });
    expect(fire('2026-09-11')[0]!.closes).toBe('2029-09-11');
  });
});

describe('when it must stay quiet', () => {
  it('says nothing at 52', () => {
    const { client, fire } = register();
    client({ dob: '1974-09-11' });
    expect(fire('2026-09-11')).toHaveLength(0);
  });

  it('goes quiet a month after the birthday, and does not return until the next one', () => {
    // The whole design: two windows, not a standing state for three years.
    const { client, fire } = register();
    client({ dob: '1973-06-01' });
    expect(fire('2026-06-15'), 'inside the window').toHaveLength(1);
    expect(fire('2026-07-05'), 'a month later').toHaveLength(0);
    expect(fire('2027-01-01'), 'the following January').toHaveLength(0);
    expect(fire('2027-06-10'), 'the 54th birthday').toHaveLength(1);
  });

  it('says nothing at 55 — too late to be worth raising as news', () => {
    const { client, fire } = register();
    client({ dob: '1971-09-11' });
    expect(fire('2026-09-11')).toHaveLength(0);
  });

  it('says nothing once the door has shut', () => {
    const { client, fire } = register();
    client({ dob: '1968-09-11' });
    expect(fire('2026-09-11')).toHaveLength(0);
  });

  it('says nothing about somebody who already holds residence', () => {
    const { client, fire } = register();
    for (const visa of ['rv_resident', 'rv_permanent', 'other_citizen_nz', 'other_citizen_au']) {
      client({ dob: '1973-09-11', visa });
    }
    expect(fire('2026-09-11')).toHaveLength(0);
  });

  it('says nothing about a company', () => {
    const { client, fire } = register();
    client({ dob: '1973-09-11', kind: 'organisation' });
    expect(fire('2026-09-11')).toHaveLength(0);
  });

  it('says nothing about an archived or inactive client', () => {
    const { client, fire } = register();
    client({ dob: '1973-09-11', status: 'archived' });
    client({ dob: '1973-09-11', status: 'inactive' });
    expect(fire('2026-09-11')).toHaveLength(0);
  });

  it('never fires on an age it had to guess', () => {
    // No date of birth, no row. An alert built on a guessed age would be worse
    // than no alert: it would be believed.
    const { client, fire } = register();
    client({ dob: null });
    expect(fire('2026-09-11')).toHaveLength(0);
  });

  it('still fires for somebody whose visa is not recorded', () => {
    // Not knowing what they hold is not a reason to assume they hold residence.
    const { client, fire } = register();
    client({ dob: '1973-09-11', visa: null });
    expect(fire('2026-09-11')).toHaveLength(1);
  });
});

describe('a leap-year birthday', () => {
  it('turns over on 1 March in a year without a 29 February', () => {
    // SQLite's date arithmetic rolls 29 February forward, which is the same
    // reading every age threshold in the instructions uses.
    const { client, fire } = register();
    client({ dob: '1972-02-29' });
    expect(fire('2026-03-01'), 'the 54th').toHaveLength(1);
  });
});
