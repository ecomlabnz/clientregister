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
