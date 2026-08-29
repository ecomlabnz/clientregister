import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin and tries to load a
// package called "sqlite" instead.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * Every fixed query in the codebase, prepared against the real schema.
 *
 * A brief that asked for `case_status_history.changed_at` — a column that has
 * never existed — reached production and failed only when somebody pressed the
 * button. Nothing caught it because nothing ran a query against a schema: the
 * unit tests read source files as text, and the schema lived in migrations
 * nobody loaded.
 *
 * This builds the database from the migrations and asks SQLite to *prepare*
 * each query. Preparing resolves table and column names without executing
 * anything, so an unknown name fails here rather than in front of a client.
 *
 * Queries assembled with interpolation — `${whereSql}`, a placeholder list —
 * cannot be prepared as written and are skipped. The count of what was checked
 * is asserted, so the coverage cannot quietly fall to nothing.
 */

function schema() {
  const db = new DatabaseSync(':memory:');
  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  return db;
}

function sourceFiles(dir = 'src'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(`${dir}/${e.name}`)
      : e.name.endsWith('.ts') ? [`${dir}/${e.name}`] : []);
}

/** Backtick strings that are entirely a statement, with nothing interpolated. */
function fixedQueries(text: string): string[] {
  return [...text.matchAll(/`([^`\\]*)`/g)]
    .map((m) => m[1]!.trim())
    .filter((q) => /^(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(q))
    .filter((q) => !q.includes('${'));
}

describe('every fixed query matches the real schema', () => {
  const db = schema();
  const found: Array<{ file: string; sql: string }> = [];
  for (const file of sourceFiles()) {
    for (const sql of fixedQueries(readFileSync(file, 'utf8'))) found.push({ file, sql });
  }

  it('checks a meaningful number of them', () => {
    // If this drops sharply, the extractor has stopped matching and the suite
    // is passing on an empty set.
    expect(found.length).toBeGreaterThan(40);
  });

  it('names only tables and columns that exist', () => {
    const broken: string[] = [];
    for (const { file, sql } of found) {
      try {
        db.prepare(sql);
      } catch (err) {
        const message = (err as Error).message;
        // Only name resolution is being tested. SQLite rejects a few shapes at
        // prepare time for unrelated reasons; those are not this test's business.
        if (/no such (column|table)/.test(message)) {
          broken.push(`${file}: ${message}\n    ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
        }
      }
    }
    expect(broken, `\n${broken.join('\n')}\n`).toEqual([]);
  });
});
