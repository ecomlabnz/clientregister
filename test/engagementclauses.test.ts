/**
 * The clauses a letter of engagement carries, and the choice to send one.
 *
 * The practice's decision, 8 September 2026: the Letter of Engagement states no
 * parties, no scope and no fees — those are the quotation's, and the letter
 * refers to it. What is left is the part that is the same every time, and a
 * handful of clauses that depend on the work: their partnership letter carries
 * a page on how INZ assesses whether a relationship is genuine, which has no
 * business on an employer accreditation.
 *
 * Two rules are held here, and both are about a contract rather than a screen.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { quotesModule } from '../src/modules/quotes';
import { clausesFor, clauseTypes, engagementText } from '../src/core/engagement';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const AT = '2026-09-08T09:00:00Z';

function db() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    d.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  return d;
}

const addClause = (d: any, over: Record<string, unknown> = {}) => {
  const row = { id: `ec_${Math.random().toString(36).slice(2, 9)}`, position: 0,
    heading: 'Discretion and no guarantee of outcome',
    body: 'The final decision rests solely with Immigration New Zealand.',
    case_types: '', active: 1, ...over };
  return (d.prepare(
    `INSERT INTO engagement_clauses (id, position, heading, body, case_types, active,
        created_at, updated_at)
     VALUES (?,?,?,?,?,?,'${AT}','${AT}')`) as any)
    .run(row.id, row.position, row.heading, row.body, row.case_types, row.active);
};

describe('a clause in a contract', () => {
  it('is refused without a heading', () => {
    // It would print as an unlabelled block of text in a contract.
    expect(() => addClause(db(), { heading: '' })).toThrow(/heading and something to say/);
    expect(() => addClause(db(), { heading: '   ' })).toThrow(/heading and something to say/);
  });

  it('is refused without anything to say', () => {
    // A heading with nothing under it reads as a clause somebody deleted.
    expect(() => addClause(db(), { body: '' })).toThrow(/heading and something to say/);
  });

  it('is refused when an edit empties either', () => {
    const d = db();
    addClause(d, { id: 'c1' });
    expect(() => d.exec("UPDATE engagement_clauses SET body = '' WHERE id = 'c1'"))
      .toThrow(/heading and something to say/);
    expect(() => d.exec("UPDATE engagement_clauses SET heading = '  ' WHERE id = 'c1'"))
      .toThrow(/heading and something to say/);
  });

  it('is switched off rather than deleted', () => {
    // A clause withdrawn from new letters must not vanish from the ones already
    // sent, and somebody will want it back.
    const d = db();
    addClause(d, { id: 'c1' });
    d.exec("UPDATE engagement_clauses SET active = 0 WHERE id = 'c1'");
    expect((d.prepare('SELECT COUNT(*) AS n FROM engagement_clauses') as any).get().n).toBe(1);
    expect(() => d.exec("UPDATE engagement_clauses SET active = 2 WHERE id = 'c1'")).toThrow();
  });

  it('says which matters it belongs on, or none, meaning all', () => {
    const d = db();
    addClause(d, { id: 'all' });
    addClause(d, { id: 'partnership', case_types: 'rv_partner wv_partner' });
    const rows = (d.prepare('SELECT id, case_types FROM engagement_clauses ORDER BY id') as any)
      .all() as Array<{ id: string; case_types: string }>;
    expect(rows.find((r) => r.id === 'all')!.case_types).toBe('');
    expect(rows.find((r) => r.id === 'partnership')!.case_types.split(' '))
      .toEqual(['rv_partner', 'wv_partner']);
  });
});

describe('whether a letter goes with a quotation', () => {
  it('is unanswered until somebody answers it', () => {
    // The practice's instruction: a mandatory choice at composition. A default
    // would mean a letter omitted by oversight, or sent by one.
    const d = db();
    d.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
            VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
    d.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,status,created_at,updated_at)
            VALUES ('q1','Q-0001','cl1','A matter',100000,'draft','${AT}','${AT}')`);
    expect((d.prepare(`SELECT with_letter AS v FROM quotes WHERE id = 'q1'`) as any).get().v)
      .toBe(null);
  });

  it('is yes or no, and nothing else', () => {
    const d = db();
    d.exec(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
            VALUES ('cl1','CL-0001','individual','A CLIENT','active','${AT}','${AT}')`);
    d.exec(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,status,with_letter,created_at,updated_at)
            VALUES ('q1','Q-0001','cl1','A matter',100000,'draft',1,'${AT}','${AT}')`);
    expect(() => d.exec("UPDATE quotes SET with_letter = 2 WHERE id = 'q1'")).toThrow();
    d.exec("UPDATE quotes SET with_letter = 0 WHERE id = 'q1'");
    expect((d.prepare(`SELECT with_letter AS v FROM quotes WHERE id = 'q1'`) as any).get().v).toBe(0);
  });
});

describe('which clauses belong on a letter', () => {
  function seeded() {
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'owner' }) });
    const add = (id: string, position: number, heading: string, types: string, active = 1) =>
      (h.db.prepare(
        `INSERT INTO engagement_clauses (id,position,heading,body,case_types,active,created_at,updated_at)
         VALUES (?,?,?,'Something it says',?,?,'${AT}','${AT}')`) as any)
        .run(id, position, heading, types, active);
    add('all', 0, 'Legal fees and disbursements', '');
    add('partnership', 1, 'Partnership assessment', 'rv_partner wv_partner');
    add('employer', 2, 'Employer accreditation', 'employer_accreditation');
    add('retired', 3, 'An old clause', '', 0);
    return h;
  }

  const headings = async (h: any, types: string[]) =>
    (await clausesFor(h.env as any, types)).map((c) => c.heading);

  it('puts a clause naming no matter type on every letter', async () => {
    const h = seeded();
    expect(await headings(h, ['employer_accreditation'])).toContain('Legal fees and disbursements');
    expect(await headings(h, [])).toContain('Legal fees and disbursements');
  });

  it('keeps a clause off a letter it does not belong on', async () => {
    // The whole reason the list exists: a page on how INZ assesses whether a
    // relationship is genuine has no business on an employer accreditation.
    const h = seeded();
    expect(await headings(h, ['employer_accreditation'])).not.toContain('Partnership assessment');
    expect(await headings(h, ['rv_partner'])).toContain('Partnership assessment');
  });

  it('includes a clause when the quotation covers any of the types it names', async () => {
    // A quotation can cover more than one matter. Requiring *every* type to
    // match would drop the partnership pages from a quotation covering a
    // partner visa and a dependent child — the letter that most needs them.
    const h = seeded();
    expect(await headings(h, ['rv_partner', 'rv_child'])).toContain('Partnership assessment');
  });

  it('leaves a switched-off clause out of new letters', async () => {
    const h = seeded();
    expect(await headings(h, ['rv_partner'])).not.toContain('An old clause');
  });

  it('keeps the order the practice put them in', async () => {
    const h = seeded();
    expect(await headings(h, ['rv_partner']))
      .toEqual(['Legal fees and disbursements', 'Partnership assessment']);
  });

  it('reads a list of types however it was typed', () => {
    expect(clauseTypes({ case_types: 'rv_partner  wv_partner' })).toEqual(['rv_partner', 'wv_partner']);
    expect(clauseTypes({ case_types: 'rv_partner, wv_partner' })).toEqual(['rv_partner', 'wv_partner']);
    expect(clauseTypes({ case_types: '   ' })).toEqual([]);
  });
});

describe('the words around the clauses', () => {
  it('ships none of them, which is the point', async () => {
    // A letter carrying wording the register invented would be worse than one
    // that went out empty: the empty one is obvious. So the register supplies
    // no opening, no acknowledgements and no closing, and says so.
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'owner' }) });
    const text = await engagementText(h.env as any);
    expect(text.opening).toBe('');
    expect(text.acknowledgements).toEqual([]);
    expect(text.closing).toBe('');
    expect(text.configured, 'an empty letter must not read as a configured one').toBe(false);
  });

  it('reads the acknowledgements one per line, dropping the blank ones', async () => {
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'owner' }) });
    h.db.exec(`INSERT INTO settings (key,value,updated_at) VALUES
      ('engagement.opening','I am pleased to act for you.','${AT}'),
      ('engagement.acknowledgements','have read these terms\n\n  accept that no outcome is guaranteed  \n','${AT}')`);
    const text = await engagementText(h.env as any);
    expect(text.acknowledgements)
      .toEqual(['have read these terms', 'accept that no outcome is guaranteed']);
    expect(text.configured).toBe(true);
  });
});

describe('who may rewrite the terms a client is asked to accept', () => {
  it('is an administrator, not everybody who can send a quote', async () => {
    // Writing a quotation is daily work. Rewriting the contract is not.
    const specialist = mountModule(quotesModule, { user: fakeUser({ role: 'adviser' }) });
    expect((await specialist.request('/quotes/clauses')).status).toBe(403);
    const owner = mountModule(quotesModule, { user: fakeUser({ role: 'owner' }) });
    expect((await owner.request('/quotes/clauses')).status).toBe(200);
  });

  it('refuses a clause with nothing in it, through the real route', async () => {
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'owner' }) });
    await h.post('/quotes/clauses', { heading: 'A heading', body: '   ' });
    expect(h.count('SELECT COUNT(*) AS n FROM engagement_clauses')).toBe(0);
  });

  it('writes one, with the matters it belongs on', async () => {
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'owner' }) });
    const body = new URLSearchParams({ _csrf: 'test-csrf-token', heading: 'Partnership assessment',
      body: 'INZ will assess whether the partnership is genuine and stable.', position: '3' });
    body.append('case_types', 'rv_partner');
    body.append('case_types', 'wv_partner');
    await h.request('/quotes/clauses', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost' }, body });
    const row = h.get<{ heading: string; case_types: string; position: number; active: number }>(
      'SELECT heading, case_types, position, active FROM engagement_clauses')!;
    expect(row.heading).toBe('Partnership assessment');
    expect(row.case_types).toBe('rv_partner wv_partner');
    expect(row.position).toBe(3);
    expect(row.active).toBe(1);
  });

  it('switches one off rather than deleting it', async () => {
    const h = mountModule(quotesModule, { user: fakeUser({ role: 'owner' }) });
    h.db.exec(`INSERT INTO engagement_clauses (id,position,heading,body,case_types,active,created_at,updated_at)
               VALUES ('c1',0,'A clause','Something','',1,'${AT}','${AT}')`);
    await h.post('/quotes/clauses/c1/toggle');
    expect(h.count('SELECT COUNT(*) AS n FROM engagement_clauses')).toBe(1);
    expect(h.get<{ active: number }>('SELECT active FROM engagement_clauses')!.active).toBe(0);
  });
});
