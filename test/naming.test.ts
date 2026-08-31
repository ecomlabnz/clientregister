import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { caseTypeShort, suggestCaseTitle } from '../src/core/vocabulary';
import { formalName } from '../src/core/names';

describe('the house convention for a matter title', () => {
  it('leads with the visa type, then the client formally', () => {
    expect(suggestCaseTitle('WV. AEWV', 'RUBEZHANSKII, Aleksei'))
      .toBe('AEWV. RUBEZHANSKII, Aleksei');
  });

  it('drops the grouping prefix so the title does not say it twice', () => {
    expect(suggestCaseTitle('WV. Partner', 'BUI, Dac Dat')).toBe('Partner. BUI, Dac Dat');
    expect(suggestCaseTitle('RV. SMC', 'CHEN, Wei')).toBe('SMC. CHEN, Wei');
  });

  it('copes with a label that has no prefix', () => {
    expect(suggestCaseTitle('Section 61 Request', 'OKAFOR, Joseph'))
      .toBe('Section 61 Request. OKAFOR, Joseph');
  });

  it('gives whichever half it has when the other is missing', () => {
    expect(suggestCaseTitle('WV. AEWV', '')).toBe('AEWV');
    expect(suggestCaseTitle('', 'BUI, Dac Dat')).toBe('BUI, Dac Dat');
  });

  it('composes the formal half the way a file is labelled', () => {
    expect(formalName({ givenNames: 'Aleksei', familyName: 'RUBEZHANSKII' }))
      .toBe('RUBEZHANSKII, Aleksei');
  });
});

describe('a matter number carries its year', () => {
  const db = readFileSync('src/core/db.ts', 'utf8');

  it('is formatted CASE-26-001', () => {
    expect(db).toContain('`${prefix}-${String(year).slice(-2)}-${String(row.value).padStart(3, \'0\')}`');
  });

  it('keeps a counter per year, created on demand', () => {
    expect(db).toContain('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)');
    expect(db).toContain('const name = `${counter}:${year}`;');
  });

  it('allocates in one atomic statement', () => {
    // A read followed by a write is where two matters opened in the same
    // second take the same number.
    expect(db).toContain('UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value');
  });
});

describe('the matter-title suggestion, which is gone', () => {
  const js = readFileSync('public/app.js', 'utf8');
  const cases = readFileSync('src/modules/cases/index.ts', 'utf8');

  /**
   * It filled the title box from the client and the type as they were chosen,
   * and it never overwrote anything typed — it worked exactly as designed,
   * which was the fault. A box that arrives plausibly filled in is never
   * replaced, so the register reached 44 matters each named after the two
   * columns already beside it on the row.
   *
   * Pinned as *absent* rather than deleted quietly, because script that fills
   * a field nothing renders is dead weight the next reader has to rule out.
   */
  it('leaves no script behind filling a field that no longer exists', () => {
    expect(js).not.toContain("title.dataset.suggested");
    expect(js).not.toContain('js-case-client');
    expect(cases).not.toContain('js-case-form');
    expect(cases).not.toContain('data-formal');
  });
});

describe('renumbering the matters already on the register', () => {
  const sql = readFileSync('migrations/0022_case_refs_by_year.sql', 'utf8');

  it('renames in two passes, because the column is unique', () => {
    // Moving one row straight to its new value collides with a row that has
    // not moved yet.
    expect(sql).toContain("UPDATE cases SET ref = 'PENDING-' || id;");
    const pending = sql.indexOf("'PENDING-'");
    const final = sql.indexOf('SELECT t.new_ref FROM case_renumber_tmp t WHERE t.case_id = cases.id');
    expect(final).toBeGreaterThan(pending);
  });

  it('numbers within the calendar year the matter was opened', () => {
    expect(sql).toContain("strftime('%Y', c2.created_at) = strftime('%Y', k.created_at)");
    expect(sql).toContain("'CASE-' || substr(strftime('%Y', k.created_at), 3, 2)");
  });

  it('leaves the counters agreeing with what was handed out', () => {
    // Otherwise the next matter opened takes a number one of these already has.
    expect(sql).toContain("DELETE FROM counters WHERE name LIKE 'case:%'");
    expect(sql).toContain("SELECT 'case:' || strftime('%Y', created_at), COUNT(*)");
  });

  it('leaves no bridge behind', () => {
    // A mapping table plus a search that reads it is a compatibility layer the
    // application carries forever. The scratch table is dropped.
    expect(sql).toContain('DROP TABLE case_renumber_tmp;');
    expect(sql).not.toContain('case_ref_history');
  });

  it('does not rewrite the audit log or existing notes', () => {
    // Append-only records of what was said at the time.
    expect(sql).not.toMatch(/UPDATE\s+audit_log/i);
    expect(sql).not.toMatch(/UPDATE\s+entries/i);
  });

  it('corrects open task titles but not finished ones', () => {
    expect(sql).toContain("AND status IN ('open', 'in_progress', 'blocked')");
  });
});

describe('a matter has a name and a thing it is about', () => {
  const cases = readFileSync('src/modules/cases/index.ts', 'utf8');
  const components = readFileSync('src/ui/components.ts', 'utf8');
  const migration = readFileSync('migrations/0026_case_descriptor.sql', 'utf8');

  it('splits the two apart on the em dash that already separated them', () => {
    // ' — ' is three *characters* but the em dash is three *bytes*, and
    // SQLite's SUBSTR counts characters. Written as +5 first, which ate the
    // first two letters of every descriptor; caught by rehearsing on a scratch
    // copy before the migration went anywhere near a real database.
    expect(migration).toContain("INSTR(title, ' — ') + 3");
    expect(migration).not.toContain("INSTR(title, ' — ') + 5");
  });

  it('keeps the subordinate line to one line', () => {
    // The reference shares the line rather than taking one of its own: a third
    // line makes every row in every list taller, and row height on these
    // tables has already had to be fixed once.
    expect(components).toContain('export function caseSubline(');
    const fn = components.slice(components.indexOf('export function caseSubline('),
      components.indexOf('export function pageHeader('));
    expect(fn).toContain("' · '");
    expect(fn).toContain('clamp-1');
  });

  it('stops saying the same thing twice', () => {
    // The title names the matter by its type and client. Repeating the type
    // underneath, or the client after a dash, says nothing new.
    expect(cases).toContain('row.descriptor || labelFor(types, row.case_type)');
    const alerts = readFileSync('src/modules/alerts/index.ts', 'utf8');
    expect(alerts).toContain('title: k.title,');
    expect(alerts).not.toContain('title: `${k.title} — ${k.client_name}`');
  });

  it('asks for the description, and asks for nothing else by way of a name', () => {
    // Reversed by the practice on 31 August 2026. The description used to be
    // optional and a "Matter title" was required beside it — pre-filled from
    // the client and the type, which is exactly the two columns already on the
    // row. Pre-filled, it arrived looking complete and was never replaced, so
    // every matter was named after itself. One field now, and it is the one
    // that says something.
    expect(cases).toContain("f.text('descriptor', { required: true");
    expect(cases).not.toContain("f.text('title'");
    // Still nullable in the database: the rows loaded before this decision
    // keep whatever they have, and a column is not made NOT NULL to enforce a
    // rule the form already enforces.
    expect(migration).not.toMatch(/descriptor[^;]*NOT NULL/);
  });

  it('feeds the title from the description, from one place', () => {
    // `title` is NOT NULL and pages still read it. Derived rather than typed,
    // so the two cannot drift into being two different names for one matter.
    expect(cases).toContain('title: descriptor,');
  });
});

describe('the short form of a case type', () => {
  it('drops the grouping prefix, which only sorts the dropdown', () => {
    expect(caseTypeShort('WV. AEWV')).toBe('AEWV');
    expect(caseTypeShort('RQ. Section 61 Request')).toBe('Section 61 Request');
    expect(caseTypeShort('EMP. Job Check')).toBe('Job Check');
  });

  it('keeps the group where what is left would name nothing', () => {
    // "SV. General" stripped to "General" gave matters called
    // "General. NGUYEN, Thi Mai". For a filler the group is the whole meaning.
    expect(caseTypeShort('SV. General')).toBe('SV');
    expect(caseTypeShort('RV. Other')).toBe('RV');
    expect(caseTypeShort('VV. General')).toBe('VV');
  });

  it('does not mistake a real type for a filler', () => {
    // "Specific Purpose" and "Permanent" are types in their own right.
    expect(caseTypeShort('WV. Specific Purpose')).toBe('Specific Purpose');
    expect(caseTypeShort('RV. Permanent')).toBe('Permanent');
  });

  it('copes with a label an administrator wrote without a prefix', () => {
    expect(caseTypeShort('S.61')).toBe('S.61');
    expect(caseTypeShort('')).toBe('');
  });

  it('is now the server rule alone, with no browser copy to disagree with it', () => {
    // app.js used to repeat this rule for the live title suggestion, and the
    // risk was the two drifting apart unnoticed. The suggestion is gone, so
    // the duplication is gone with it — which is the better answer to "keep
    // two copies in step" than keeping them in step.
    const appjs = readFileSync('public/app.js', 'utf8');
    expect(appjs).not.toContain("specific = group;");
  });
});

/**
 * Adding somebody who is not on file yet.
 *
 * A party who does not exist as a client is the ordinary case, not the
 * exception — a partner, a child, an employer. Sending an adviser to the client
 * form and back loses the matter they were working on, and produces exactly the
 * record this produces.
 */
describe('creating a party from the matter', () => {
  const cases = readFileSync('src/modules/cases/index.ts', 'utf8');

  it('writes the name through the same helpers as the client form', () => {
    // Otherwise there are two answers to "how is a family name stored", and
    // one of them is whatever somebody typed.
    const route = cases.slice(cases.indexOf("r.post('/:id/parties/new'"),
                              cases.indexOf("r.post('/:id/parties',"));
    expect(route).toContain('familyNameFor(familyName)');
    expect(route).toContain('plainAscii(givenNames');
    expect(route).toContain("composeFullName('individual'");
  });

  it('gives them a reference of their own', () => {
    // A party is a client in their own right, with their own documents and
    // expiry dates. A record without a reference is not one.
    const route = cases.slice(cases.indexOf("r.post('/:id/parties/new'"),
                              cases.indexOf("r.post('/:id/parties',"));
    expect(route).toContain("nextRef(c.env.DB, 'client', 'CL')");
  });

  it('asks for four things and no more', () => {
    // The rest of what the register holds about a person belongs on that
    // person's page. A longer form here would be a second client form to keep
    // in step with the first.
    const form = cases.slice(cases.indexOf('<h4>Somebody not on file yet</h4>'),
                             cases.indexOf('Creates a client record'));
    const fields = [...form.matchAll(/name: '(\w+)'/g)].map((m) => m[1]!);
    expect(fields).toEqual(['given_names', 'family_name', 'role', 'email']);
  });

  it('records it on the file and in the audit log', () => {
    const route = cases.slice(cases.indexOf("r.post('/:id/parties/new'"),
                              cases.indexOf("r.post('/:id/parties',"));
    expect(route).toContain('addEntry');
    expect(route).toContain("action: 'client.created'");
    expect(route).toContain("from: 'case_party'");
  });

  it('leaves the adviser on the matter they were working on', () => {
    // The whole point. A redirect anywhere else and this is the old journey
    // with extra steps.
    const route = cases.slice(cases.indexOf("r.post('/:id/parties/new'"),
                              cases.indexOf("r.post('/:id/parties',"));
    expect(route).toContain('return redirectWith(c, `/cases/${id}`');
    expect(route).not.toContain('/clients/new');
  });
});

describe('two ways of adding a party, told apart', () => {
  it('divides them, rather than running one into the other', () => {
    // Without a rule the second form reads as more of the first, which is how
    // somebody fills in half of each and presses the wrong button.
    const cases = readFileSync('src/modules/cases/index.ts', 'utf8');
    const block = cases.slice(cases.indexOf('<summary>Add a party</summary>'),
                             cases.indexOf('Creates a client record'));
    expect(block).toContain('<div class="or-rule">or</div>');
    expect(block.indexOf('or-rule')).toBeGreaterThan(block.indexOf('action="/cases/${kase.id}/parties"'));
    expect(block.indexOf('or-rule')).toBeLessThan(block.indexOf('/parties/new'));
  });

  it('names the second choice at heading weight, not as a hint', () => {
    // The old wording was a sentence in small grey text. A route somebody has
    // to notice is a route that fails.
    const cases = readFileSync('src/modules/cases/index.ts', 'utf8');
    expect(cases).toContain('<h4>Somebody not on file yet</h4>');
    expect(cases).not.toContain('Create a client</a> first if they are not on file');
  });
});
