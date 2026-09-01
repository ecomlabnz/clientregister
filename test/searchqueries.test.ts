/**
 * Every search query must actually run.
 *
 * `searchEverything` fires eleven queries at once and returns them together, so
 * a syntax error in any one of them takes the whole Search page down with a 500
 * — which is what a stray parenthesis did while multi-word matching was being
 * added. Nothing caught it, because nothing executed the SQL.
 *
 * So this does: it builds the real schema from the migrations, runs the real
 * function against it, and fails if any query is rejected. It asserts nothing
 * about results — other tests do that. It asserts that the SQL is SQL.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { searchEverything } from '../src/core/search';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

function schema() {
  const d = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    d.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  return d;
}

/** Collects every query the search runs, and whether the database accepted it. */
function recordingEnv(d: any, rejected: string[]) {
  return { DB: { prepare: (sql: string) => ({ bind: (...p: unknown[]) => ({ all: async () => {
    try { return { results: d.prepare(sql).all(...p) }; }
    catch (e: any) { rejected.push(`${e.message}\n${sql}`); return { results: [] }; }
  } }) }) } } as any;
}

describe('the queries behind the search box', () => {
  // One word, two, and several: the number of words changes the SQL that is
  // built, so each shape has to be executed.
  for (const q of ['Luisa', 'GARCIA Luisa', 'GARCIA, Maria Luisa', 'a b c d e']) {
    it(`runs every query for “${q}”`, async () => {
      const rejected: string[] = [];
      await searchEverything(recordingEnv(schema(), rejected), q);
      expect(rejected, rejected.join('\n\n')).toEqual([]);
    });
  }

  it('runs every query when the words contain LIKE wildcards', async () => {
    // A person typing % or _ means the character, not "everything".
    const rejected: string[] = [];
    await searchEverything(recordingEnv(schema(), rejected), '100% _ok');
    expect(rejected, rejected.join('\n\n')).toEqual([]);
  });

  it('binds one parameter for every placeholder it writes', async () => {
    // The failure this guards is silent in SQLite and loud in D1: a query that
    // names ?4 while only three values are bound.
    const seen: Array<{ sql: string; params: number }> = [];
    const d = schema();
    const env = { DB: { prepare: (sql: string) => ({ bind: (...p: unknown[]) => ({ all: async () => {
      seen.push({ sql, params: p.length });
      return { results: d.prepare(sql).all(...p) };
    } }) }) } } as any;
    await searchEverything(env, 'GARCIA Maria Luisa');
    expect(seen.length).toBeGreaterThan(5);
    for (const { sql, params } of seen) {
      const highest = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      expect(highest, sql).toBeLessThanOrEqual(params);
    }
  });
});

/**
 * No list page may go back to matching the whole phrase.
 *
 * The bug was reported on Clients and turned out to be on Cases, Quotes,
 * Invoices, Knowledge and the dashboard lookup too — every filter had been
 * written the same way, separately, and each one had to be found by hand. This
 * reads the source and fails if a new one appears, which is cheaper than
 * finding out from a search that quietly returns nothing.
 */
describe('every list filter matches word by word', () => {
  const files = [
    'src/modules/clients/index.ts',
    'src/modules/cases/index.ts',
    'src/modules/quotes/index.ts',
    'src/modules/invoices/index.ts',
    'src/modules/knowledge/index.ts',
    'src/modules/dashboard/index.ts',
    'src/modules/inbox/index.ts',
    'src/modules/search/index.ts',
    'src/core/filing.ts',
    'src/core/search.ts',
  ];

  it('builds its LIKE pattern from words, never from the raw query', () => {
    // `%${q}%` — the whole phrase, wrapped — is the shape of the bug.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (/`%\$\{\s*(q|q0|query|raw)\s*\}%`/.test(line)) offenders.push(`${f}:${i + 1}  ${line.trim()}`);
      }
    }
    expect(offenders, `whole-phrase matching:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('never mixes ? and ?1 placeholders in one statement', () => {
    // Legal SQL, and a trap: the plain ones take the next free slot while the
    // numbered ones count from the start, so two conditions can read the same
    // value. Quotes did exactly that — status and text filtering collided.
    const offenders: string[] = [];
    for (const f of [...files, 'src/core/search.ts', 'src/core/filing.ts']) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/`([^`]*\bLIKE\b[^`]*)`/g)) {
        const sql = m[1]!;
        if (/LIKE \? /.test(sql) && /\?\d/.test(sql)) offenders.push(`${f}: ${sql.slice(0, 90)}`);
      }
    }
    expect(offenders, `mixed placeholders:\n${offenders.join('\n')}`).toEqual([]);
  });
});
