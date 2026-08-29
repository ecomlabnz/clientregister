import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { suggestCaseTitle } from '../src/core/vocabulary';
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

describe('the suggestion never overwrites what somebody typed', () => {
  const js = readFileSync('public/app.js', 'utf8');

  it('only fills a box it filled itself, or an empty one', () => {
    expect(js).toContain("if (title.value && title.dataset.suggested !== '1') return;");
  });

  it('lets go the moment the box is typed in', () => {
    expect(js).toContain("title.addEventListener('input', function () { delete title.dataset.suggested; });");
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
