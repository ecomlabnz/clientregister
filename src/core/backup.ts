/**
 * A copy of the whole register, in one file.
 *
 * **Asked for on 9 September 2026:** *"i need you to make one full back up copy
 * of all data in the register in a zip file for download"*, and then *"include
 * the passport numbers - the whole lot"*, and *"one button - but only available
 * to owner"*.
 *
 * `docs/operations.md` has carried "there is still no automated backup" as the
 * largest single risk since the register went live. This is not that — a button
 * somebody has to press is not automatic — but it is the thing that makes the
 * risk survivable today, and it is the piece an automatic one would call.
 *
 * ## What goes in, and why all of it
 *
 * Every table, every column, **including passport numbers**. The practice's
 * standing rule keeps those out of bulk *exports*, and this is not an export: an
 * export is for reading somewhere else, a backup is for putting the register
 * back. One that omits a column cannot do that, and a backup you cannot restore
 * from is a file that makes people feel safe without being safe. The decision
 * was put to the practice in those terms and taken by them.
 *
 * So the archive says what it is on the outside — the filename carries the
 * date, the README says in its first line that this is the entire client file
 * — because the danger of this object is that it looks like a download and is
 * in fact the practice's whole book of business.
 *
 * ## The shape
 *
 * `schema.sql`, then `data/*.sql` in order, then `triggers.sql` is the restore
 * path, and it is plain SQL so it can be replayed by `wrangler d1 execute
 * --file` or by anything else that speaks SQLite. `tables/<table>.json` is the
 * reading path, for a spreadsheet or a script, because a practice that has lost
 * its register should not also have to parse SQL to find one client's address.
 *
 * **Two things about that order were learned by trying it**, and both are the
 * difference between a file that restores and a file that looks like it would:
 *
 * 1. **The data files are numbered in dependency order**, not alphabetical.
 *    Alphabetical put `case_parties` before `cases` and `invoice_items` before
 *    `invoices`, so 36 of 51 tables were refused on foreign keys and the
 *    restored database had no clients in it at all. The order is worked out
 *    from what each table references, so `for f in data/*.sql` is enough and
 *    nobody has to know to turn foreign keys off.
 * 2. **The triggers are created after the data, not before it.** This register
 *    keeps its rules as triggers, and they are rules about what may be *done*
 *    now — not about what was true in 2026. Loading history through them means
 *    today's rules judging yesterday's records, and a restore that half-refuses
 *    the practice's own past. They go on at the end, over a database that is
 *    already whole.
 *
 * The files in R2 come too. A `documents` row naming a file that is not in the
 * archive is a reference to nothing.
 */

import type { Env } from '../types';
import { all, one } from './db';
import { makeZip, type ZipEntry } from './zip';

/**
 * Tables the register owns.
 *
 * Two families are somebody else's. `sqlite_%` is SQLite's own bookkeeping.
 * `_cf_%` is D1's: it keeps a `_cf_METADATA` table which `sqlite_master`
 * cheerfully lists and which D1 then **refuses to read** —
 * `access to _cf_METADATA.key is prohibited: SQLITE_AUTH` — so a backup that
 * simply took everything `sqlite_master` named failed on the first press
 * against a real D1 and worked perfectly in every test, because the SQLite the
 * tests run on has no such table. Excluded here and excluded from the schema
 * dump, since neither is ours to restore.
 */
const NOT_OURS = `name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'`;

async function tableNames(env: Env): Promise<string[]> {
  const rows = await all<{ name: string }>(
    env.DB,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND ${NOT_OURS} ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

/**
 * The order the data files have to load in.
 *
 * Read off the `CREATE TABLE` text rather than asked of the database, because
 * `PRAGMA foreign_key_list` is not something to bet a backup on being available
 * through D1 — and the schema is already in hand. Every `REFERENCES <table>` is
 * an edge; a table goes after everything it points at.
 *
 * Self-references (a parent row in the same table) are dropped: they order rows
 * within one file, which this cannot help with, and keeping them would make a
 * cycle out of nothing. A genuine cycle between two tables would stall the
 * sort, so whatever is left over is appended in name order rather than silently
 * dropped — a wrong order loses nothing that foreign keys off cannot fix, but a
 * missing table loses records.
 */
export function loadOrder(schema: Array<{ name: string; sql: string }>): string[] {
  const names = new Set(schema.map((t) => t.name));
  const needs = new Map<string, Set<string>>();
  for (const { name, sql } of schema) {
    const found = new Set<string>();
    for (const m of sql.matchAll(/\bREFERENCES\s+["'`\[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/gi)) {
      const target = m[1]!;
      if (target !== name && names.has(target)) found.add(target);
    }
    needs.set(name, found);
  }

  const out: string[] = [];
  const done = new Set<string>();
  const waiting = [...names].sort();
  let moved = true;
  while (moved && waiting.length) {
    moved = false;
    for (let i = 0; i < waiting.length; i++) {
      const name = waiting[i]!;
      if (![...needs.get(name)!].every((d) => done.has(d))) continue;
      out.push(name); done.add(name); waiting.splice(i, 1); i--; moved = true;
    }
  }
  return [...out, ...waiting];
}

/**
 * The columns by which a table points at itself, and are safe to fill in later.
 *
 * `clients` has two — the organisation a person belongs to, and that
 * organisation's main contact — and between them they are why ordering the
 * *files* was not enough. Those two point at each other: the organisation names
 * the person, the person names the organisation, and whichever is written first
 * refers to a row that does not exist yet. No sorting of rows fixes that,
 * because there is no order that works.
 *
 * So the rows go in with these columns empty and an `UPDATE` at the end of the
 * same file fills them, which is what every database's own dump tool does with
 * a loop. Only nullable columns can be treated this way; a `NOT NULL` self
 * reference is left where it is, since blanking it would be refused — the
 * register has none today, and if one appears its file will say so by failing
 * rather than by loading something untrue.
 *
 * Read off the same `CREATE TABLE` text as the file order.
 */
function deferrableSelfRefs(sql: string, table: string): string[] {
  const body = sql.slice(sql.indexOf('('));
  const out = new Set<string>();
  const pattern = new RegExp(
    `["'\`\\[]?([A-Za-z_][A-Za-z0-9_]*)["'\`\\]]?([^,()]*?)\\bREFERENCES\\s+["'\`\\[]?${table}["'\`\\]]?`,
    'gi');
  for (const m of body.matchAll(pattern)) {
    const name = m[1]!;
    if (name.toUpperCase() === 'KEY' || name === table) continue;
    if (/\bNOT\s+NULL\b/i.test(m[2]!)) continue;
    out.add(name);
  }
  return [...out];
}

/**
 * One SQL literal.
 *
 * Numbers and nulls go in bare; everything else is a quoted string with its
 * quotes doubled, which is SQLite's only escape. Blobs would need X'..' and the
 * register stores none — files live in R2 — so a blob arriving here is a change
 * somebody made without reading this, and it becomes text rather than silently
 * becoming nothing.
 */
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

export interface BackupSummary {
  takenAt: string;
  tables: Array<{ name: string; rows: number }>;
  files: number;
  fileBytes: number;
  bytes: number;
}

/**
 * Build the archive. Returns the bytes and what went into them, so the caller
 * can write an audit row saying what was taken rather than that something was.
 */
export async function makeBackup(
  env: Env,
  opts: {
    version: string;
    takenBy: string;
    /**
     * Whether the documents themselves go in. Default true — a backup missing
     * them cannot restore the register, which is the one job it has.
     *
     * **The nightly backup sets it false, deliberately.** Two reasons, and the
     * second is the one that matters. The documents already live in R2, and the
     * nightly archive is written to R2: copying them from a bucket into a file
     * in the same bucket buys nothing against the failure it is guarding — a
     * database lost or corrupted. And the whole archive is built in memory
     * inside a Worker, so an archive that grows with every document uploaded is
     * a backup that works every night until the night it quietly stops.
     *
     * The manual button keeps them. That one is for taking the register away
     * with you, and there it is the whole point. See `core/autobackup.ts`.
     */
    includeFiles?: boolean;
  },
): Promise<{ zip: Uint8Array; summary: BackupSummary }> {
  const takenAt = new Date();
  const stamp = takenAt.toISOString();

  const schema = await all<{ type: string; name: string; sql: string }>(
    env.DB,
    `SELECT type, name, sql FROM sqlite_master
      WHERE sql IS NOT NULL AND ${NOT_OURS}
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
  );
  const tables = schema.filter((r) => r.type === 'table');
  const names = loadOrder(tables);

  const entries: ZipEntry[] = [];
  const counts: Array<{ name: string; rows: number }> = [];

  // Everything that has to exist before a row can be written — but not the
  // triggers, which come after the rows. See the note at the top of this file.
  entries.push({
    name: 'schema.sql',
    body: `-- The register's schema, as it stands at ${stamp}.\n`
      + '-- Tables and indexes. Run this first, then data/, then triggers.sql.\n\n'
      + schema.filter((r) => r.type !== 'trigger').map((r) => `${r.sql};`).join('\n\n') + '\n',
  });

  entries.push({
    name: 'triggers.sql',
    body: `-- The register's rules, as they stand at ${stamp}.\n`
      + '-- Run this LAST, after every data file. These are rules about what may\n'
      + '-- be done now; loading history through them is today judging yesterday.\n\n'
      + schema.filter((r) => r.type === 'trigger').map((r) => `${r.sql};`).join('\n\n') + '\n',
  });

  for (const [index, table] of names.entries()) {
    const raw = await all<Record<string, unknown>>(env.DB, `SELECT * FROM "${table}"`);
    counts.push({ name: table, rows: raw.length });

    const rows = raw;

    // Numbered, so `data/*.sql` in shell order is dependency order. The JSON
    // copy is for reading, so it is filed under its plain name.
    const step = String(index + 1).padStart(3, '0');
    entries.push({ name: `tables/${table}.json`, body: JSON.stringify(rows, null, 1) });

    const later = deferrableSelfRefs(tables.find((t) => t.name === table)?.sql ?? '', table);
    const key = Object.keys(rows[0] ?? {}).includes('id') ? 'id' : null;

    const inserts = rows.map((row) => {
      const columns = Object.keys(row);
      return `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${
        columns.map((c) => (later.includes(c) ? 'NULL' : literal(row[c]))).join(', ')});`;
    });

    // The deferred columns, filled in once every row of this table exists.
    const updates = key === null ? [] : rows.flatMap((row) => {
      const set = later.filter((c) => row[c] !== null && row[c] !== undefined);
      if (set.length === 0) return [];
      return [`UPDATE "${table}" SET ${set.map((c) => `"${c}" = ${literal(row[c])}`).join(', ')}`
        + ` WHERE "${key}" = ${literal(row[key])};`];
    });

    const body = `-- ${table}: ${rows.length} row${rows.length === 1 ? '' : 's'}.\n`
      + (inserts.length ? `${inserts.join('\n')}\n` : '')
      + (updates.length
        ? `\n-- ${later.join(', ')}: this table points at itself, so these are set once\n`
          + `-- every row above exists. See src/core/backup.ts.\n${updates.join('\n')}\n`
        : '');
    entries.push({ name: `data/${step}_${table}.sql`, body });
  }

  // The files themselves. A row naming a file the archive does not hold is a
  // reference to nothing, which is the failure a backup exists to prevent.
  let fileBytes = 0;
  const keys = opts.includeFiles === false ? [] : await all<{ r2_key: string }>(
    env.DB,
    `SELECT r2_key FROM documents WHERE r2_key NOT LIKE 'link:%'
      UNION SELECT r2_key FROM kb_documents`,
  );
  for (const { r2_key: key } of keys) {
    const object = await env.DOCS?.get(key);
    if (!object) continue;
    const body = new Uint8Array(await object.arrayBuffer());
    fileBytes += body.length;
    entries.push({ name: `files/${key}`, body });
  }

  const totalRows = counts.reduce((n, t) => n + t.rows, 0);
  entries.push({
    name: 'manifest.json',
    body: JSON.stringify({
      taken_at: stamp,
      taken_by: opts.takenBy,
      register_version: opts.version,
      tables: counts,
      total_rows: totalRows,
      files: entries.filter((e) => e.name.startsWith('files/')).length,
      file_bytes: fileBytes,
      contains_passport_numbers: true,
      contains_documents: opts.includeFiles !== false,
    }, null, 1),
  });

  entries.push({
    name: 'README.md',
    body: `# The whole register, ${stamp.slice(0, 10)}

**This file is the practice's entire client file.** Every table, every column,
including passport numbers. Treat it the way you would treat the filing cabinet
it stands for: it is not a document to email, and a copy on a laptop is a copy
of everything about ${counts.find((t) => t.name === 'clients')?.rows ?? 0} people.

Taken at ${stamp} by ${opts.takenBy}, from version ${opts.version}.
${totalRows} rows across ${counts.length} tables, plus
${entries.filter((e) => e.name.startsWith('files/')).length} files.

## What is in it

- \`schema.sql\` — every table and index.
- \`data/NNN_<table>.sql\` — the rows, as INSERT statements, numbered in the
  order they have to load in.
- \`triggers.sql\` — the register's rules. Last, not first.
- \`tables/<table>.json\` — the same rows, for reading with anything else.
- \`files/<key>\` — the documents themselves, under the key the register stores.
- \`manifest.json\` — what was taken, when, and how much of it.

## Putting it back

Into an empty database, in three steps, in this order:

    wrangler d1 execute <database> --remote --file=schema.sql
    for f in data/*.sql; do wrangler d1 execute <database> --remote --file="$f"; done
    wrangler d1 execute <database> --remote --file=triggers.sql

The order matters and the numbering does the work: a table is loaded after
everything it points at, so nothing has to be run with foreign keys off. The
triggers go on at the end, over a database that is already whole — they are
rules about what may be done now, and history should not have to pass them.

The files under \`files/\` go back into the R2 bucket under the same keys.

## What this is not

It is a copy taken at one moment by somebody pressing a button. It is not an
automatic backup, and nothing takes another one tomorrow. See
\`docs/operations.md\`.
`,
  });

  const zip = await makeZip(entries, takenAt);
  return {
    zip,
    summary: {
      takenAt: stamp,
      tables: counts,
      files: entries.filter((e) => e.name.startsWith('files/')).length,
      fileBytes,
      bytes: zip.length,
    },
  };
}

/** `client-register-backup-2026-09-09.zip` — the date is the point of it. */
export function backupFilename(at: string): string {
  return `client-register-backup-${at.slice(0, 10)}.zip`;
}
