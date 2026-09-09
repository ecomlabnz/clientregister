/**
 * Four faults found by an audit on 8 September 2026, and the rules that now
 * hold them.
 *
 * All four are the same species: **a guarantee that lived in one handler.** The
 * register's standing rule says invariants belong in the database, and each of
 * these was written as a check in the route that happened to be in front of
 * somebody's mind at the time. Then a second route was written.
 *
 *   1. The intake wrote a client, then let the database refuse the matter — so
 *      a failed press left a half-made client and the retry made another.
 *   2. A quotation's client could be edited away from its matter's, so the
 *      letter of engagement printed one person's name over another's file.
 *   3. The letter chose its clauses from the matter's kind of work *or* the
 *      lines', never both, and the kind of work chosen on the New quote form
 *      was thrown away entirely.
 *   4. Converting an inquiry named the matter after its own description — the
 *      third writer of a fault fixed twice already.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { assistantModule } from '../src/modules/assistant';
import { quotesModule } from '../src/modules/quotes';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-09T00:00:00Z';
const USER = fakeUser();
const VOCAB = 'rv_partner | RV. Partner\nwv_aewv | WV. AEWV';

function schema() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  return db;
}

describe('1. a failed press leaves nothing behind', () => {
  const RUN = 'air_fix_0001';
  const READING = {
    applicant: { given_names: 'Aroha', family_name: 'WHAREPAPA', preferred_name: null,
                 email: null, phone: null, nationalities: ['NZ'], current_visa_type: null,
                 current_visa_expiry: null, occupation: null, date_of_birth: null,
                 role: 'principal_applicant' },
    other_parties: [], case_type: 'wv_aewv', suggested_title: 'A matter',
    inz_client_number: null, inz_application_number: null, lodged_on: null,
    decision_due_on: null, next_action: null, summary: 'Short.', file_note: 'The whole of it.',
    missing: [],
  };

  const mount = () => {
    const h = mountModule(assistantModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`)
      .run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('vocab.case_types', ?, ?)
                  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(VOCAB, AT);
    h.db.prepare(`INSERT INTO ai_runs (id, kind, provider, model, status, input_hash, output_json,
                                       latency_ms, created_at)
                  VALUES (?, 'intake', 'test', 'test', 'ok', 'x', ?, 1, ?)`)
      .run(RUN, JSON.stringify(READING), AT);
    return h;
  };

  const press = (h: ReturnType<typeof mount>, over: Record<string, string> = {}) =>
    h.post('/assistant/intake/apply', {
      run: RUN, a_given_names: 'Aroha', a_family_name: 'WHAREPAPA',
      descriptor: 'A matter', case_type: 'wv_aewv', status: 'engaged',
      assigned_to: USER.id, summary: 'Short.', file_note: 'The whole of it.',
      party_count: '0', ...over,
    });

  it('creates no client when the owner is missing', async () => {
    // The matter would be refused by the database — `cases_have_an_owner` — and
    // the client is written first, without a transaction around the two. So the
    // owner is checked before anything at all is written.
    const h = mount();
    const res = await press(h, { assigned_to: '' });
    expect(res.status).toBe(303);
    expect(h.count('SELECT COUNT(*) AS n FROM clients')).toBe(0);
    expect(h.count('SELECT COUNT(*) AS n FROM cases')).toBe(0);
    expect(h.count("SELECT COUNT(*) AS n FROM entries WHERE entity_type = 'client'")).toBe(0);
  });

  it('creates no client when the owner cannot be given work', async () => {
    const h = mount();
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES ('gone','g@b.test','Gone','x','assistant','suspended',?,?)`).run(AT, AT);
    const res = await press(h, { assigned_to: 'gone' });
    expect(res.status).toBe(303);
    expect(h.count('SELECT COUNT(*) AS n FROM clients')).toBe(0);
  });

  it('still opens the matter when the owner is good', async () => {
    // The vacuity guard: a press that refused everything would pass both of the
    // tests above and be useless.
    const h = mount();
    await press(h);
    expect(h.count('SELECT COUNT(*) AS n FROM clients')).toBe(1);
    expect(h.count('SELECT COUNT(*) AS n FROM cases')).toBe(1);
  });
});

describe('2. a quotation belongs to one client', () => {
  const seed = (db: any) => {
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','active','${AT}','${AT}');
             INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('mine','CL-1','individual','The Client','active','${AT}','${AT}'),
                    ('other','CL-2','individual','Somebody Else','active','${AT}','${AT}');
             INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-1','mine','A matter','rv_partner','engaged','u1','${AT}','${AT}');
             INSERT INTO quotes (id,ref,client_id,case_id,description,amount_cents,gst_cents,
                                 disbursements_cents,currency,status,created_at,updated_at)
             VALUES ('q1','Q-1','mine','k1','A quote',0,0,0,'NZD','draft','${AT}','${AT}')`);
  };
  const refuses = (db: any, sql: string) => {
    try { db.exec(sql); return null; } catch (e: any) { return String(e.message); }
  };

  it('refuses moving the quotation on to a different client', () => {
    // Not tidiness: the letter of engagement joins the quotation's client with
    // the matter's reference and clauses, so a mismatch prints one person's
    // name over another's file. It is a contract.
    const db = schema(); seed(db);
    expect(refuses(db, `UPDATE quotes SET client_id = 'other' WHERE id = 'q1'`))
      .toMatch(/that matter's client/);
  });

  it('refuses attaching a matter whose client is somebody else', () => {
    const db = schema(); seed(db);
    db.exec(`INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k2','CASE-2','other','Another','rv_partner','engaged','u1','${AT}','${AT}')`);
    expect(refuses(db, `UPDATE quotes SET case_id = 'k2' WHERE id = 'q1'`))
      .toMatch(/that matter's client/);
  });

  it('refuses it on insert as well as on update', () => {
    const db = schema(); seed(db);
    expect(refuses(db, `INSERT INTO quotes (id,ref,client_id,case_id,description,amount_cents,
                          gst_cents,disbursements_cents,currency,status,created_at,updated_at)
                        VALUES ('q2','Q-2','other','k1','X',0,0,0,'NZD','draft','${AT}','${AT}')`))
      .toMatch(/that matter's client/);
  });

  it('leaves a quotation with no matter alone', () => {
    // Three of the six live quotations have no client at all, and a quotation
    // for a lead is the ordinary case rather than the exception.
    const db = schema(); seed(db);
    expect(refuses(db, `UPDATE quotes SET case_id = NULL, client_id = 'other' WHERE id = 'q1'`))
      .toBe(null);
  });
});

describe('3. the letter sees every kind of work on the quotation', () => {
  it('records the kind of work on the quotation itself', () => {
    const db = schema();
    const cols = (db.prepare(`SELECT name FROM pragma_table_info('quotes')`).all() as any[])
      .map((r) => r.name);
    expect(cols, 'the New quote form asked for it and threw it away').toContain('case_type');
  });

  it('backfills it from the matter where there is one', () => {
    const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    const db = new DatabaseSync(':memory:');
    for (const f of files.filter((f) => f < '0075')) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','active','${AT}','${AT}');
             INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('c1','CL-1','individual','A','active','${AT}','${AT}');
             INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-1','c1','A matter','rv_partner','engaged','u1','${AT}','${AT}');
             INSERT INTO quotes (id,ref,client_id,case_id,description,amount_cents,gst_cents,
                                 disbursements_cents,currency,status,created_at,updated_at)
             VALUES ('q1','Q-1','c1','k1','A quote',0,0,0,'NZD','draft','${AT}','${AT}')`);
    db.exec(readFileSync(`migrations/${files.find((f) => f.startsWith('0075'))!}`, 'utf8'));
    expect(((db.prepare(`SELECT case_type FROM quotes WHERE id='q1'`) as any).get()).case_type)
      .toBe('rv_partner');
  });

  it('takes the union of all three sources, not one instead of the others', async () => {
    // A quotation covering partnership residence *and* a dependent child got
    // the clauses of whichever branch won, while the comment above the code
    // promised both. The union is the fix.
    const h = mountModule(quotesModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                  VALUES (?,?,?,'x',?,'active',?,?)`)
      .run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.exec(`INSERT INTO settings (key, value, updated_at) VALUES ('vocab.case_types', '${VOCAB}', '${AT}')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value;
               INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
               VALUES ('c1','CL-1','individual','A Client','active','${AT}','${AT}');
               INSERT INTO quotes (id,ref,client_id,description,case_type,amount_cents,gst_cents,
                                   disbursements_cents,currency,status,with_letter,created_at,updated_at)
               VALUES ('q1','Q-1','c1','A quote','rv_partner',0,0,0,'NZD','draft',1,'${AT}','${AT}');
               INSERT INTO quote_items (id,quote_id,position,case_type,description,kind,unit_label,
                                        quantity_milli,unit_amount_cents,net_cents,gst_cents,
                                        gross_cents,created_at,updated_at)
               VALUES ('qi1','q1',0,'wv_aewv','A line','professional','item',1000,1000,1000,150,1150,
                       '${AT}','${AT}');
               INSERT INTO engagement_clauses (id,position,heading,body,case_types,active,
                                               created_at,updated_at)
               VALUES ('cl_p',1,'Partnership clause','About partnerships.','rv_partner',1,'${AT}','${AT}'),
                      ('cl_w',2,'Work clause','About work visas.','wv_aewv',1,'${AT}','${AT}'),
                      ('cl_x',3,'Unrelated clause','Not this work.','sv_student',1,'${AT}','${AT}')`);
    const body = await (await h.request('/quotes/q1/letter')).text();
    expect(body, 'the quotation’s own kind of work').toContain('Partnership clause');
    expect(body, 'the kind of work on a line').toContain('Work clause');
    expect(body, 'a clause for work this quotation does not cover').not.toContain('Unrelated clause');
  });
});

describe('4. every writer of a matter name composes it', () => {
  it('has no route writing the description into the title', () => {
    // Three routes create matters. Two were corrected on 8 September and the
    // third — converting an inquiry — was missed, because the guard test only
    // read the file that had been fixed. It reads all three now.
    for (const file of ['src/modules/cases/index.ts',
                        'src/modules/assistant/intake.ts',
                        'src/modules/inquiries/index.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} creates matters without composing the name`)
        .toContain('caseNameFrom(');
    }
  });
});
