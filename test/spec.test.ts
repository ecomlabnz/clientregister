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
  .flatMap((r: { sql: string }) => {
    // **Every** RAISE, not the first. This read one per trigger until
    // 9 September 2026, which quietly excused ten refusals from the document —
    // four of the five reasons an inquiry cannot be deleted were undocumented,
    // and the two delete triggers added that day would have contributed one
    // line between them for nine rules. A trigger is not one refusal; it is a
    // list of them, and the list is the point.
    const when = /(?:BEFORE|AFTER)\s+(\w+)(?:\s+OF\s+[\w,\s]+)?\s+ON/i.exec(r.sql)?.[1];
    if (!when) return [];
    return [...r.sql.matchAll(/RAISE\(ABORT,\s*'((?:[^']|'')*)'\)/g)]
      .map((m) => `${when.toLowerCase()}|${m[1]!.replace(/''/g, "'")}`);
  });

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
    [...dataModel.matchAll(/^## `([a-z0-9_]+)`$/gm)].map((m) => m[1]!),
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

/**
 * The counts on the specification's own front page.
 *
 * `docs/spec/README.md` introduces the other documents by number: so many
 * refusals, so many tables, so many routes. Those numbers had drifted to 51, 45
 * and 178 against a schema holding 67, 48 and 195 — while the documents they
 * describe were each being held against the code by a test.
 *
 * That is fault 21's shape (a stated number about a measured thing goes stale in
 * silence) and fault 23's (a document that "cannot drift" needs something to say
 * so). The index escaped both because it is prose about documents rather than a
 * document about the schema.
 */
describe('the numbers on the front page of the specification', () => {
  const readme = readFileSync('docs/spec/README.md', 'utf8');
  const stated = (label: string): number => {
    const found = readme.match(new RegExp(`(\\d+) ${label}`));
    expect(found, `the README no longer states a number of ${label}`).toBeTruthy();
    return Number(found![1]);
  };

  it('says how many things the database refuses, and agrees with the document', () => {
    // Held against `invariants.md` rather than re-counted from the schema,
    // because that document is itself held against the schema by the test
    // above — and it counts distinct rules where the triggers contain 71
    // RAISE statements, several of which are the same refusal written for an
    // insert and again for an update. Two independent counts of one thing is
    // how a front page comes to disagree with the page behind it.
    const inInvariants = readFileSync('docs/spec/invariants.md', 'utf8')
      .match(/\*\*(\d+) refusals\*\*/);
    expect(inInvariants, 'invariants.md no longer states its own count').toBeTruthy();
    expect(stated('things the database refuses')).toBe(Number(inInvariants![1]));
  });

  it('says how many tables there are, and is right', () => {
    const db = schema();
    const tables = (db.prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'`) as any)
      .get() as { n: number };
    expect(stated('tables, every column')).toBe(tables.n);
  });

  it('says how many routes there are, and is right', () => {
    // Counted from the complete list only. The public routes are deliberately
    // printed twice — once on their own, because that short list *is* the
    // public surface and is the thing to read first, and again in the full
    // table — so counting every row in the file counts those twice.
    const doc = readFileSync('docs/spec/routes.md', 'utf8');
    const complete = doc.slice(doc.indexOf('## Every route'));
    const routes = (complete.match(/^\| (?:GET|POST|PUT|DELETE) /gm) ?? []).length;
    expect(routes, 'the complete route table is missing').toBeGreaterThan(100);
    expect(stated('routes and the permission')).toBe(routes);
  });

  it('says how many faults have been suffered, and agrees with the list', () => {
    // Written as a word ("Forty-two") it escaped this block entirely while the
    // list grew to forty-five: `stated()` reads digits, so a number spelled out
    // is a number nothing checks. It is a digit now for that reason.
    const doc = readFileSync('docs/spec/mistakes.md', 'utf8');
    const faults = (doc.match(/^### \d+\. /gm) ?? []).length;
    expect(faults, 'the numbered fault list is missing').toBeGreaterThan(30);
    expect(stated('faults, each with the rule')).toBe(faults);
  });

  it('lists every module that is actually mounted', async () => {
    const { registeredModules } = await import('../src/registry');
    const features = readFileSync('docs/spec/features.md', 'utf8');
    const missing = registeredModules.map((m) => m.name).filter((n) => !features.includes(`\`${n}\``));
    expect(missing, `not in features.md: ${missing.join(', ')}`).toEqual([]);
    expect(stated('modules')).toBe(registeredModules.length);
  });

  it('lists every permission there is', async () => {
    const { PERMISSIONS } = await import('../src/core/rbac');
    const doc = readFileSync('docs/spec/permissions.md', 'utf8');
    const missing = [...PERMISSIONS].filter((p) => !doc.includes(`\`${p}\``));
    expect(missing, `not in permissions.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('lists every setting an administrator can change', async () => {
    // The list that answers "what may differ between two practices", so a
    // setting missing from it is a gap in the plan, not just in a document.
    const { registeredModules } = await import('../src/registry');
    const keys = registeredModules.flatMap((m) => (m.settings ?? []).flatMap(
      (g: { settings: Array<{ key: string }> }) => g.settings.map((s) => s.key)));
    const doc = readFileSync('docs/spec/settings.md', 'utf8');
    const missing = keys.filter((k) => !doc.includes(`\`${k}\``));
    expect(missing, `not in settings.md: ${missing.join(', ')}`).toEqual([]);
    expect(stated('settings —')).toBe(keys.length);
  });
});
