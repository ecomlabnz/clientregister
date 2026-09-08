/**
 * The INZ client number belongs to the person.
 *
 * **Asked 8 September 2026, urgently:** *"every individual client must have INZ
 * Client Number - implement for all now please."*
 *
 * It had no column on `clients` at all. It lived on `cases`, so the same
 * person's number was typed again on every matter — and in the live register
 * that had already produced two clients whose own matters disagreed and two
 * client records sharing one number.
 *
 * Four things are held here, and each is a way the old shape went wrong:
 *
 *   1. The number is written on the client and read back from the matter.
 *   2. The database refuses anything that is not six to twelve digits, so
 *      "N/A" and a pasted line of a letter cannot become a client number.
 *   3. No two clients may hold the same one — which is how the same person
 *      entered twice gets caught.
 *   4. Migration 0073 carries the live numbers across without losing any: what
 *      cannot be carried is written into an append-only file note first.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { clientsModule } from '../src/modules/clients';
import { CHECKS_NOT_ABOUT_A_DATE } from '../src/modules/alerts';
import { OPEN_CASE_STATUSES } from '../src/domain';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-08T09:00:00Z';
const USER = fakeUser();

function mount() {
  const h = mountModule(clientsModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
                VALUES (?,?,?,'x',?,'active',?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.exec(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
             VALUES ('cl1','CL-0001','individual','Duc Manh BUI','Duc Manh','NGUYEN','active','${AT}','${AT}'),
                    ('cl2','CL-0002','individual','Van Hung DINH','Van Hung','HOANG','active','${AT}','${AT}')`);
  return h;
}

/** The form posts every box, so a partial post would blank the rest. */
const clientForm = (over: Record<string, string> = {}) => ({
  kind: 'individual', given_names: 'Duc Manh', family_name: 'NGUYEN',
  status: 'active', ...over,
});

describe('the number is the client’s', () => {
  it('is saved from the client form', async () => {
    const h = mount();
    await h.post('/clients/cl1', clientForm({ inz_client_number: '60012345' }));
    expect(h.get<{ v: string | null }>('SELECT inz_client_number v FROM clients WHERE id = ?', 'cl1')!.v).toBe('60012345');
  });

  it('accepts one written with the spaces it is read aloud in', async () => {
    // A number copied off a letter arrives as "600 123 45" as often as not.
    // Refusing that would teach the practice that the box is broken.
    const h = mount();
    await h.post('/clients/cl1', clientForm({ inz_client_number: '600 123-45' }));
    expect(h.get<{ v: string | null }>('SELECT inz_client_number v FROM clients WHERE id = ?', 'cl1')!.v).toBe('60012345');
  });

  it('refuses one that is not a number, and says which box', async () => {
    const h = mount();
    const res = await h.post('/clients/cl1', clientForm({ inz_client_number: 'N/A' }));
    // The form comes back with the message on it rather than a redirect that
    // loses what was typed — the same path the NZBN check takes.
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('six to twelve digits');
    expect(h.get<{ v: string | null }>('SELECT inz_client_number v FROM clients WHERE id = ?', 'cl1')!.v).toBe(null);
  });

  it('leaves it empty when nothing is typed, rather than storing an empty string', async () => {
    // A client INZ has never issued one to is the normal case, not an error.
    const h = mount();
    await h.post('/clients/cl1', clientForm({ inz_client_number: '' }));
    expect(h.get<{ v: string | null }>('SELECT inz_client_number v FROM clients WHERE id = ?', 'cl1')!.v).toBe(null);
  });

  it('finds the person by it', async () => {
    // The whole point of holding it: a letter from INZ quotes the number and
    // nothing else you can search on.
    const h = mount();
    await h.post('/clients/cl1', clientForm({ inz_client_number: '60012345' }));
    const body = await (await h.request('/clients?view=all&q=60012345')).text();
    expect(body).toContain('CL-0001');
    expect(body).not.toContain('CL-0002');
  });
});

describe('what the database itself refuses', () => {
  const schema = () => {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) {
      db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('a','CL-1','individual','A','active','${AT}','${AT}'),
                    ('b','CL-2','individual','B','active','${AT}','${AT}')`);
    return db;
  };
  const refuses = (db: any, sql: string) => {
    try { db.exec(sql); return null; } catch (e: any) { return String(e.message); }
  };

  it('refuses letters, on insert and on update alike', () => {
    const db = schema();
    expect(refuses(db, `UPDATE clients SET inz_client_number = 'N/A' WHERE id = 'a'`))
      .toMatch(/six to twelve digits/);
    expect(refuses(db, `INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at,inz_client_number)
                        VALUES ('c','CL-3','individual','C','active','${AT}','${AT}','pending')`))
      .toMatch(/six to twelve digits/);
  });

  it('refuses one too short and one too long', () => {
    const db = schema();
    expect(refuses(db, `UPDATE clients SET inz_client_number = '12345' WHERE id = 'a'`))
      .toMatch(/six to twelve digits/);
    expect(refuses(db, `UPDATE clients SET inz_client_number = '1234567890123' WHERE id = 'a'`))
      .toMatch(/six to twelve digits/);
  });

  it('refuses two clients holding the same one', () => {
    // Not tidiness: two records with one INZ client number are one person
    // entered twice, and this is where that is caught.
    const db = schema();
    expect(refuses(db, `UPDATE clients SET inz_client_number = '60012345' WHERE id = 'a'`)).toBe(null);
    expect(refuses(db, `UPDATE clients SET inz_client_number = '60012345' WHERE id = 'b'`))
      .toMatch(/UNIQUE/i);
  });

  it('lets any number of clients hold none', () => {
    // The partial index earns its keep here: empty is the normal state, and a
    // plain unique index would allow exactly one client without a number.
    const db = schema();
    expect(refuses(db, `UPDATE clients SET inz_client_number = NULL WHERE id = 'a'`)).toBe(null);
    expect(refuses(db, `UPDATE clients SET inz_client_number = NULL WHERE id = 'b'`)).toBe(null);
    expect((db.prepare(`SELECT COUNT(*) n FROM clients WHERE inz_client_number IS NULL`) as any).get().n).toBe(2);
  });

  it('has taken the column off matters, so there is one place to write it', () => {
    const db = schema();
    const cols = (db.prepare(`SELECT name FROM pragma_table_info('cases')`).all() as any[])
      .map((r) => r.name);
    expect(cols).not.toContain('inz_client_number');
    expect(cols, 'the application number is per-matter and stays').toContain('inz_application_number');
  });
});

describe('migration 0073 moves the live numbers without losing one', () => {
  /** Everything up to 0073, then the matters, then 0073 itself. */
  const upTo73 = (seed: (db: any) => void) => {
    const db = new DatabaseSync(':memory:');
    const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
    for (const f of files.filter((f) => f < '0073')) db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','active','${AT}','${AT}')`);
    seed(db);
    db.exec(readFileSync(`migrations/${files.find((f) => f.startsWith('0073'))!}`, 'utf8'));
    return db;
  };
  const client = (id: string, ref: string, createdAt: string) =>
    `INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
     VALUES ('${id}','${ref}','individual','${ref}','active','${createdAt}','${createdAt}');`;
  const matter = (id: string, ref: string, clientId: string, num: string | null) =>
    `INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,inz_client_number,
                        created_at,updated_at)
     VALUES ('${id}','${ref}','${clientId}','${ref}','wv_aewv','lodged','u1',${
       num === null ? 'NULL' : `'${num}'`},'${AT}','${AT}');`;
  const numberOn = (db: any, id: string) =>
    (db.prepare('SELECT inz_client_number v FROM clients WHERE id = ?').get(id) as any).v;

  it('carries across the number a person’s matters agree on', () => {
    const db = upTo73((d) => d.exec(
      client('c1', 'CL-1', AT) + matter('k1', 'CASE-1', 'c1', '60012345')
      + matter('k2', 'CASE-2', 'c1', '60012345')));
    expect(numberOn(db, 'c1')).toBe('60012345');
  });

  it('leaves it empty where the matters disagree, and says so on the file', () => {
    // A wrong INZ client number is worse than a missing one: you would query
    // INZ about somebody else. So no guess is made, not even the commoner of
    // the two.
    const db = upTo73((d) => d.exec(
      client('c1', 'CL-1', AT) + matter('k1', 'CASE-1', 'c1', '60012345')
      + matter('k2', 'CASE-2', 'c1', '60012345') + matter('k3', 'CASE-3', 'c1', '69999999')));
    expect(numberOn(db, 'c1')).toBe(null);
    const note = ((db.prepare(`SELECT body FROM entries WHERE id = 'ent_inz73_c1'`) as any).get()).body;
    expect(note).toContain('60012345');
    expect(note).toContain('69999999');
    expect(((db.prepare(`SELECT COUNT(*) n FROM flags WHERE id = 'flg_inz73_c1'`) as any).get()).n).toBe(1);
  });

  it('gives a number two records claim to the one that had it first', () => {
    // Same number, two client records: one person entered twice. The unique
    // index will not take both, so the older record keeps it and the newer one
    // is flagged for the practice to merge.
    const db = upTo73((d) => d.exec(
      client('older', 'CL-1', '2026-08-01T00:00:00Z') + client('newer', 'CL-2', '2026-09-04T00:00:00Z')
      + matter('k1', 'CASE-1', 'older', '60012345') + matter('k2', 'CASE-2', 'newer', '60012345')));
    expect(numberOn(db, 'older')).toBe('60012345');
    expect(numberOn(db, 'newer')).toBe(null);
    expect(((db.prepare(`SELECT COUNT(*) n FROM flags WHERE id = 'flg_inz73_newer'`) as any).get()).n).toBe(1);
  });

  it('loses no number: every one is on a client or in an append-only note', () => {
    const db = upTo73((d) => d.exec(
      client('c1', 'CL-1', AT) + client('c2', 'CL-2', '2026-09-04T00:00:00Z')
      + matter('k1', 'CASE-1', 'c1', '60012345') + matter('k2', 'CASE-2', 'c1', '69999999')
      + matter('k3', 'CASE-3', 'c2', '61111111')));
    const kept = new Set((db.prepare(
      'SELECT inz_client_number v FROM clients WHERE inz_client_number IS NOT NULL').all() as any[])
      .map((r) => r.v));
    const notes = (db.prepare(`SELECT body FROM entries WHERE id LIKE 'ent_inz73_%'`).all() as any[])
      .map((r) => r.body).join(' ');
    for (const num of ['60012345', '69999999', '61111111']) {
      expect(kept.has(num) || notes.includes(num), `${num} was lost`).toBe(true);
    }
  });

  it('writes no audit row on a register that had none to move', () => {
    // An audit log that fills with "nothing happened" is one nobody reads.
    const db = upTo73((d) => d.exec(client('c1', 'CL-1', AT)));
    expect(((db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE id = 'aud_inz73'`) as any).get()).n).toBe(0);
  });

  it('records what it did when it did something', () => {
    const db = upTo73((d) => d.exec(
      client('c1', 'CL-1', AT) + matter('k1', 'CASE-1', 'c1', '60012345')));
    const row = (db.prepare(`SELECT meta_json FROM audit_log WHERE id = 'aud_inz73'`) as any).get();
    expect(JSON.parse(row.meta_json)).toMatchObject({ carried_across: 1, matters_read: 1 });
  });
});

describe('the alerts page lists who is still missing one', () => {
  // The practice's instruction cannot be a column that refuses to be empty: a
  // first-time applicant has no number until INZ issues one, so a NOT NULL
  // would mean "no new client may be entered". The requirement lives here
  // instead, as a list that can actually be worked through.
  const withMatters = () => {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) {
      db.exec(readFileSync(`migrations/${f}`, 'utf8'));
    }
    db.exec(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
             VALUES ('u1','a@b.test','A','x','owner','active','${AT}','${AT}')`);
    return db;
  };
  const rows = (db: any) => db.prepare(
    CHECKS_NOT_ABOUT_A_DATE.noInzNumber(OPEN_CASE_STATUSES.map(() => '?').join(',')),
  ).all(...OPEN_CASE_STATUSES) as any[];

  it('lists an individual with a live matter and no number', () => {
    const db = withMatters();
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('c1','CL-1','individual','A','active','${AT}','${AT}');
             INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-1','c1','A','wv_aewv','lodged','u1','${AT}','${AT}')`);
    expect(rows(db).map((r) => r.client_ref)).toEqual(['CL-1']);
  });

  it('drops off the list the moment the number is entered', () => {
    const db = withMatters();
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('c1','CL-1','individual','A','active','${AT}','${AT}');
             INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-1','c1','A','wv_aewv','lodged','u1','${AT}','${AT}');
             UPDATE clients SET inz_client_number = '60012345' WHERE id = 'c1'`);
    expect(rows(db)).toEqual([]);
  });

  it('leaves out organisations, which do not hold one', () => {
    // A row that can never be cleared teaches people to ignore the list.
    const db = withMatters();
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('o1','CL-1','organisation','A Ltd','active','${AT}','${AT}');
             INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-1','o1','A','wv_aewv','lodged','u1','${AT}','${AT}')`);
    expect(rows(db)).toEqual([]);
  });

  it('leaves out somebody with no live matter', () => {
    const db = withMatters();
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('c1','CL-1','individual','A','active','${AT}','${AT}');
             INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-1','c1','A','wv_aewv','closed','u1','${AT}','${AT}')`);
    expect(rows(db)).toEqual([]);
  });

  it('counts the matters, so the busiest file is recognisable', () => {
    const db = withMatters();
    db.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
             VALUES ('c1','CL-1','individual','A','active','${AT}','${AT}');
             INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
             VALUES ('k1','CASE-1','c1','A','wv_aewv','lodged','u1','${AT}','${AT}'),
                    ('k2','CASE-2','c1','A','wv_aewv','preparing','u1','${AT}','${AT}')`);
    expect(rows(db)[0]!.matters).toBe(2);
  });
});
