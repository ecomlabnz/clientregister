/**
 * The specification documents, held against the schema they describe.
 *
 * `docs/spec/README.md` says of three of them: *"generated from the code and
 * cannot drift from it"*. On 4 September 2026 two of them had drifted anyway.
 * `data-model.md` still described `fee_items` and `fee_shares`, dropped a
 * release earlier, and had never heard of `invoice_shares`, added in the same
 * one; `invariants.md` counted 39 refusals when the database had 51 and named
 * a uniqueness rule on a table that no longer existed.
 *
 * The reason is small and worth naming: `scripts/spec-schema.mjs` extracts the
 * schema to JSON, and a person writes the Markdown from it. That is a perfectly
 * good arrangement — the prose in those documents is worth more than a
 * generator would produce — but it makes "cannot drift" a claim rather than a
 * fact, and a claim nobody checks is how a rebuild ends up with the wrong
 * tables.
 *
 * So this checks it. Not the prose, which is meant to be written: the *set* of
 * tables and the *set* of things the database refuses, which are facts.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

function schema() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  return db;
}

const db = schema();

const tables: string[] = (db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
      AND name <> 'd1_migrations' ORDER BY name`,
) as any).all().map((r: { name: string }) => r.name);

/**
 * Every refusal, as `insert|the message`.
 *
 * The *when* is part of it, not decoration. A rule the database keeps on
 * insert and not on update is a different rule from one it keeps on both, and
 * a document that lists the message once has not said which — so these are
 * compared as a bag of (when, message) pairs rather than a set of messages.
 */
const refusals: string[] = (db.prepare(
  `SELECT sql FROM sqlite_master WHERE type='trigger'`,
) as any).all()
  .map((r: { sql: string }) => {
    const message = /RAISE\(ABORT,\s*'((?:[^']|'')*)'\)/.exec(r.sql)?.[1];
    const when = /(?:BEFORE|AFTER)\s+(\w+)(?:\s+OF\s+[\w,\s]+)?\s+ON/i.exec(r.sql)?.[1];
    return message && when ? `${when.toLowerCase()}|${message.replace(/''/g, "'")}` : null;
  })
  .filter((m: string | null): m is string => m !== null);

/** Compare two bags, so a duplicated row is not the same as a single one. */
function tally(items: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of items) out.set(item, (out.get(item) ?? 0) + 1);
  return out;
}

const dataModel = readFileSync('docs/spec/data-model.md', 'utf8');
const invariants = readFileSync('docs/spec/invariants.md', 'utf8');

describe('data-model.md', () => {
  const documented = new Set(
    [...dataModel.matchAll(/^### `([a-z0-9_]+)`$/gm)].map((m) => m[1]!),
  );

  it('describes every table the migrations build', () => {
    expect(tables.length, 'no tables were read').toBeGreaterThan(20);
    const missing = tables.filter((t) => !documented.has(t));
    expect(missing, `undocumented: ${missing.join(', ')}`).toEqual([]);
  });

  it('describes no table that does not exist', () => {
    const gone = [...documented].filter((t) => !tables.includes(t));
    expect(gone, `documented but dropped: ${gone.join(', ')}`).toEqual([]);
  });
});

describe('invariants.md', () => {
  // Rows read as `| insert | the message |`.
  const rows = [...invariants.matchAll(/^\| (insert|update|delete) \| (.+?) \|$/gm)]
    .map((m) => `${m[1]}|${m[2]!.trim()}`);
  const listed = tally(rows);
  const real = tally(refusals);

  it('quotes every refusal in the words the database uses', () => {
    expect(refusals.length, 'no refusals were read').toBeGreaterThan(40);
    const missing = [...real].filter(([r, n]) => (listed.get(r) ?? 0) < n).map(([r]) => r);
    expect(missing, `not documented: ${missing.join(' / ')}`).toEqual([]);
  });

  it('quotes nothing the database no longer says', () => {
    const stale = [...listed].filter(([r, n]) => (real.get(r) ?? 0) < n).map(([r]) => r);
    expect(stale, `documented but gone: ${stale.join(' / ')}`).toEqual([]);
  });

  it('counts what it lists', () => {
    // The number in the prose is the thing that went stale, so it is the thing
    // pinned. It is written as "**51 refusals** across 20 tables".
    const stated = /\*\*(\d+) refusals\*\* across (\d+) tables/.exec(invariants);
    expect(stated, 'the header no longer states a count').not.toBeNull();
    expect(Number(stated![1])).toBe(refusals.length);
    const withRefusals = new Set((db.prepare(
      `SELECT tbl_name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%RAISE(ABORT%'`,
    ) as any).all().map((r: { tbl_name: string }) => r.tbl_name));
    expect(Number(stated![2])).toBe(withRefusals.size);
  });
});
