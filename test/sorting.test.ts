import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { CASE_SORTS } from '../src/modules/cases';
import { CLIENT_SORTS } from '../src/modules/clients';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * Sortable column headings put a sort key in the address bar, where anyone can
 * edit it. Two things must hold, and neither is visible by reading the page.
 *
 * The key must be a *lookup*, never interpolation. `?sort=k.ref) --` has to
 * find nothing and leave the list in its default order; if the key were
 * pasted into ORDER BY it would be an injection with a URL for a payload.
 *
 * And what the lookup finds must be real SQL over real columns. A sort by a
 * column that does not exist is a 500 on a page that worked yesterday — the
 * same failure a brief hit when it asked for `case_status_history.changed_at`.
 */

const MAPS: Record<string, Record<string, string[]>> = { cases: CASE_SORTS, clients: CLIENT_SORTS };

function schema() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  return db;
}

describe('sort keys are looked up, not interpolated', () => {
  it('offers the headings both lists actually show', () => {
    // If a map is emptied the injection tests below would pass vacuously.
    expect(Object.keys(CASE_SORTS).sort()).toEqual(['client', 'due', 'owner', 'ref', 'status', 'title']);
    expect(Object.keys(CLIENT_SORTS).sort()).toEqual(['cases', 'contact', 'name', 'ref', 'status', 'updated']);
  });

  it('keys are plain words, so a key is never mistakable for SQL', () => {
    for (const [list, map] of Object.entries(MAPS)) {
      for (const key of Object.keys(map)) expect(`${list}:${key}`).toMatch(/^[a-z]+:[a-z_]+$/);
    }
  });

  it('nothing a visitor can type appears in either list', () => {
    // The direction is the only other part of ORDER BY that comes from the
    // query string, and it is narrowed to two literals at the point of use.
    for (const [list, file] of [['cases', 'src/modules/cases/index.ts'], ['clients', 'src/modules/clients/index.ts']]) {
      const text = readFileSync(file!, 'utf8');
      expect(`${list}: ${text.includes("const dirSql = sortDir === 'desc' ? 'DESC' : 'ASC';")}`)
        .toBe(`${list}: true`);
      // The order clause is built from the looked-up columns. The raw query
      // value must not be reachable from it.
      const order = text.match(/const orderSql = [\s\S]*?;\n/)![0];
      expect(`${list}: ${order}`).not.toMatch(/req\.query|asked/);
    }
  });
});

describe('every sort key names columns that exist', () => {
  const db = schema();
  // The order clause is assembled the same way the pages assemble it, then
  // prepared against the schema built from the migrations. Preparing resolves
  // every name without running anything.
  const FROM: Record<string, string> = {
    cases: `SELECT k.id FROM cases k
              JOIN clients cl ON cl.id = k.client_id
              LEFT JOIN users u ON u.id = k.assigned_to`,
    clients: `SELECT c.id, (SELECT COUNT(*) FROM cases k WHERE k.client_id = c.id) AS open_cases
                FROM clients c`,
  };
  const tie: Record<string, string> = { cases: 'k.ref', clients: 'c.ref' };

  for (const [list, map] of Object.entries(MAPS)) {
    for (const [key, cols] of Object.entries(map)) {
      for (const dir of ['ASC', 'DESC'] as const) {
        it(`${list} by ${key}, ${dir.toLowerCase()}`, () => {
          const order = `${cols.map((e) => `${e} ${dir}`).join(', ')}, ${tie[list]} ASC`;
          expect(() => db.prepare(`${FROM[list]} ORDER BY ${order}`)).not.toThrow();
        });
      }
    }
  }
});
