/**
 * What a visa lets someone do, and for how long at a time.
 *
 * **Asked for on 11 September 2026, in two parts.** *"under immigration tab -
 * we should be able to enter visa conditions as well - not sure if this is
 * needed but if AI is going to be filling it in - why not."* And: *"Need to be
 * able to enter more visa details - validity - say 4 months from each entry,
 * and 6 month in any 12 months. - for example - but do not complicate it as we
 * often do not know when the person is entering the country - so do not want to
 * be flooded with alerts and warnings."*
 *
 * The second half of that sentence is the part worth testing. Two columns that
 * hold words are easy; what has to keep being true is that **nothing counts
 * from them** — no alert, no expiry, no derived date. A stay limit becomes a
 * period only when somebody crosses a border, and the register has no record of
 * that. The test at the bottom is the one that matters in a year: it reads the
 * alerts module and asserts the two column names appear nowhere in it.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';

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
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0901','individual','A Person','A','PERSON','active','${AT}','${AT}')`);
  return h;
}

const personForm = (over: Record<string, string> = {}) => ({
  kind: 'individual', given_names: 'A', family_name: 'PERSON', status: 'active', ...over,
});

const CONDITIONS = 'May only work for Acme Limited in the role of Chef, in Wellington. '
  + 'Must not undertake study of more than three months.';
const STAY = '4 months per entry; 6 months in any 12 months';

describe('the two boxes save and come back', () => {
  it('saves both from the client form', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', personForm({
      current_visa_conditions: CONDITIONS, current_visa_stay_limit: STAY,
    }));
    expect(res.status).toBe(303);
    const row = h.get<{ current_visa_conditions: string; current_visa_stay_limit: string }>(
      'SELECT current_visa_conditions, current_visa_stay_limit FROM clients WHERE id = ?', 'cl1')!;
    expect(row.current_visa_conditions).toBe(CONDITIONS);
    expect(row.current_visa_stay_limit).toBe(STAY);
  });

  it('saves both on a client being created', async () => {
    const h = mount();
    const res = await h.post('/clients', personForm({
      full_name: 'B Person', current_visa_conditions: CONDITIONS, current_visa_stay_limit: STAY,
    }));
    expect(res.status).toBe(303);
    const row = h.get<{ current_visa_conditions: string; current_visa_stay_limit: string }>(
      `SELECT current_visa_conditions, current_visa_stay_limit FROM clients
        WHERE id <> 'cl1' ORDER BY created_at DESC`)!;
    expect(row.current_visa_conditions).toBe(CONDITIONS);
    expect(row.current_visa_stay_limit).toBe(STAY);
  });

  it('shows both on the client page', async () => {
    const h = mount();
    await h.post('/clients/cl1', personForm({
      current_visa_conditions: CONDITIONS, current_visa_stay_limit: STAY,
    }));
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).toContain('Stay limit');
    expect(body).toContain(STAY);
    expect(body).toContain('Conditions');
    expect(body).toContain('May only work for Acme Limited');
  });

  it('shows neither row on a client who has neither', async () => {
    // A page full of em dashes is how a page stops being read.
    const h = mount();
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).not.toContain('Stay limit');
    expect(body).not.toContain('<dt>Conditions</dt>');
  });

  it('offers both boxes on the immigration tab of the form', async () => {
    const h = mount();
    const body = await (await h.request('/clients/cl1/edit')).text();
    expect(body).toContain('name="current_visa_stay_limit"');
    expect(body).toContain('name="current_visa_conditions"');
  });
});

describe('the database holds the only rule either column has', () => {
  it('refuses conditions longer than a grant letter, on insert', () => {
    const db = bareRegister();
    expect(() => db.prepare(
      `INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at,
                            current_visa_conditions)
       VALUES ('c2','CL-9002','individual','B Person','active',?,?,?)`)
      .run(AT, AT, 'x'.repeat(2001)))
      .toThrow(/2000 characters or fewer/);
  });

  it('refuses conditions longer than a grant letter, on update', () => {
    const db = bareRegister();
    expect(() => db.prepare(
      `UPDATE clients SET current_visa_conditions = ? WHERE id = 'c1'`).run('x'.repeat(2001)))
      .toThrow(/2000 characters or fewer/);
  });

  it('allows exactly the ceiling', () => {
    const db = bareRegister();
    db.prepare(`UPDATE clients SET current_visa_conditions = ? WHERE id = 'c1'`).run('x'.repeat(2000));
    const stmt = db.prepare(`SELECT LENGTH(current_visa_conditions) AS n FROM clients WHERE id = 'c1'`);
    const row = (stmt as any).get() as { n: number };
    expect(row.n).toBe(2000);
  });

  it('refuses a stay limit longer than a line', () => {
    const db = bareRegister();
    expect(() => db.prepare(
      `UPDATE clients SET current_visa_stay_limit = ? WHERE id = 'c1'`).run('x'.repeat(301)))
      .toThrow(/300 characters or fewer/);
  });

  it('lets both be empty, which is what almost every client is', () => {
    const db = bareRegister();
    const stmt = db.prepare(
      `SELECT current_visa_conditions AS c, current_visa_stay_limit AS s FROM clients WHERE id = 'c1'`);
    const row = (stmt as any).get() as { c: string | null; s: string | null };
    expect(row.c).toBe(null);
    expect(row.s).toBe(null);
  });
});

describe('nothing is ever counted from either of them', () => {
  it('the alerts never read either column', () => {
    // The whole point of the request: *"do not want to be flooded with alerts
    // and warnings."* A stay limit is not a date the register can know, and a
    // date the register guesses is worse than no date, because a date is what
    // the alerts read.
    const alerts = readFileSync('src/modules/alerts/index.ts', 'utf8');
    expect(alerts).not.toContain('current_visa_stay_limit');
    expect(alerts).not.toContain('current_visa_conditions');
  });

  it('no migration derives a date from either column', () => {
    for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(`migrations/${f}`, 'utf8');
      if (!sql.includes('current_visa_stay_limit') && !sql.includes('current_visa_conditions')) continue;
      // 0088 is the only one that may mention them, and it only bounds length.
      expect(f).toBe('0088_what_a_visa_lets_someone_do.sql');
      expect(sql).not.toMatch(/current_visa_expiry\s*=/);
    }
  });
});
