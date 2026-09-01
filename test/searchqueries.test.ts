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
  for (const q of ['Khuong', 'NGUYEN Khuong', 'NGUYEN, Minh Khuong', 'a b c d e']) {
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
    await searchEverything(env, 'NGUYEN Minh Khuong');
    expect(seen.length).toBeGreaterThan(5);
    for (const { sql, params } of seen) {
      const highest = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      expect(highest, sql).toBeLessThanOrEqual(params);
    }
  });
});
