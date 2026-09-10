/**
 * A visa has a start as well as an end.
 *
 * **Reported on 10 September 2026:** *"how did this happen that in a client
 * under immigration I am not able to enter their NZ immigration status??? type
 * of visa they hold, issue date and expiry date?"*
 *
 * Two of the three were there. The visa type is a dropdown from the practice's
 * own vocabulary, and the expiry has a field and a "not yet fixed" rule beside
 * it. The issue date had never been built — and the certificates on the same
 * record have carried a date *and* an expiry since they were written, so the
 * inconsistency had been sitting there unnoticed because nothing asked for it.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-10T00:00:00Z';
const USER = fakeUser();

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
  const dates = (start: string | null, expiry: string | null) =>
    db.prepare('UPDATE clients SET current_visa_start = ?, current_visa_expiry = ? WHERE id = ?')
      .run(start, expiry, 'c1');
  return { db, dates };
}

describe('the database on a visa that ends before it begins', () => {
  it('refuses it', () => {
    const { dates } = register();
    expect(() => dates('2026-06-01', '2026-05-31')).toThrow(/cannot expire before it was granted/);
  });

  it('refuses it on insert as well as on update', () => {
    const { db } = register();
    expect(() => db.prepare(
      `INSERT INTO clients (id, ref, kind, full_name, status, current_visa_start,
                            current_visa_expiry, created_at, updated_at)
       VALUES ('c2','CL-9002','individual','B Person','active','2026-06-01','2020-01-01',?,?)`)
      .run(AT, AT)).toThrow(/cannot expire before it was granted/);
  });

  it('allows a visa granted and expiring on the same day', () => {
    // A one-day grant is unusual, not impossible, and the register does not
    // get to decide which visas INZ issues.
    const { dates } = register();
    expect(() => dates('2026-06-01', '2026-06-01')).not.toThrow();
  });

  it('says nothing when only one of the two is known', () => {
    // A visa recorded before its start date has been read off the grant letter
    // is a normal half-filled record, not an error.
    const { dates } = register();
    expect(() => dates('2026-06-01', null)).not.toThrow();
    expect(() => dates(null, '2026-06-01')).not.toThrow();
    expect(() => dates(null, null)).not.toThrow();
  });
});

describe('recording a visa through the form', () => {
  function mount() {
    const h = mountModule(clientsModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`)
      .run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
    return h;
  }
  const read = (h: ReturnType<typeof mount>) =>
    (h.db.prepare(`SELECT current_visa_type, current_visa_start, current_visa_expiry
                     FROM clients WHERE id = ?`) as any).get('c1') as
      { current_visa_type: string | null; current_visa_start: string | null; current_visa_expiry: string | null };

  it('keeps all three: what they hold, when it started, when it ends', async () => {
    const h = mount();
    const res = await h.post('/clients/c1', {
      kind: 'individual', given_names: 'A', family_name: 'PERSON', status: 'active',
      current_visa_type: 'wv_aewv',
      current_visa_start: '2025-03-01',
      current_visa_expiry: '2028-03-01',
    });
    expect(res.status).toBe(303);
    expect(read(h)).toEqual({
      current_visa_type: 'wv_aewv',
      current_visa_start: '2025-03-01',
      current_visa_expiry: '2028-03-01',
    });
  });

  it('offers the field on the form', async () => {
    const body = await (await mount().request('/clients/c1/edit')).text();
    expect(body).toContain('current_visa_start');
    expect(body).toContain('Current visa issued');
  });

  it('shows the grant date on the client page', async () => {
    const h = mount();
    h.db.prepare('UPDATE clients SET current_visa_type = ?, current_visa_start = ? WHERE id = ?')
      .run('wv_aewv', '2025-03-01', 'c1');
    const body = await (await h.request('/clients/c1')).text();
    expect(body).toContain('Granted');
    expect(body).toContain('1 Mar 2025');
  });
});
