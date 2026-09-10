/**
 * Records the practice is only testing with, and getting rid of them.
 *
 * **Asked for on 11 September 2026:** *"i, the admins and owners, must be able
 * to use a 'test' tick or mark to mark any data as test data - so it can be
 * deleted later on without any further questions."*
 *
 * The register has held the practice's real client files since 30 August 2026.
 * There is nowhere else to try things, so things get tried here, and until now
 * nothing told a rehearsal apart from a real file.
 *
 * ## What lives here and what lives in the database
 *
 * The *rules* are in migration 0083 — that the mark travels down a file and
 * never up, that it cannot come off a quotation, that a file note may be
 * deleted only with the test record it belongs to. Those are triggers, because
 * a rule enforced by this file would hold only for as long as every route
 * remembers to call it.
 *
 * What lives here is the small amount that genuinely is application work: the
 * list of tables that can carry a mark, the order they have to be deleted in,
 * and the audit line.
 *
 * ## The delete order is not arbitrary
 *
 * Deleting a client cascades to their cases, but a quotation, an invoice and an
 * inquiry only have their `client_id` set to null — they would survive as
 * orphans with no name on them. So the purge works from the leaves inward and
 * relies on the mark having already travelled down: everything under a test
 * client is itself marked, so each table can be emptied of its own marked rows
 * in an order that never leaves a child behind.
 */

import type { Env } from '../types';
import { all, one, run } from './db';
import { audit } from './audit';

/** What a mark can be put on, and what the practice calls each of them. */
export const TEST_TABLES = {
  clients: 'client',
  cases: 'matter',
  quotes: 'quotation',
  inquiries: 'inquiry',
  invoices: 'invoice',
  tasks: 'task',
} as const;

export type TestTable = keyof typeof TEST_TABLES;

export function isTestTable(value: string): value is TestTable {
  return Object.prototype.hasOwnProperty.call(TEST_TABLES, value);
}

/**
 * Children before parents.
 *
 * `invoices` first because an invoice can hang off a quotation, a matter and a
 * client at once; `clients` last because everything can hang off a client.
 * Getting this wrong does not corrupt anything — the foreign keys are all
 * `SET NULL` or `CASCADE` — but it would leave nameless rows behind, which is
 * exactly what the practice asked not to have to think about.
 */
const DELETE_ORDER: TestTable[] = ['invoices', 'quotes', 'inquiries', 'tasks', 'cases', 'clients'];

/** Where a file note can be filed, and the table that owns each. */
const NOTE_OWNERS: Record<string, TestTable> = {
  client: 'clients', case: 'cases', quote: 'quotes', inquiry: 'inquiries', invoice: 'invoices',
};

/**
 * Put the mark on, or take it off.
 *
 * The database decides whether this is allowed — a quotation refuses to have
 * its mark lifted, and marking anything sweeps what is filed under it. This
 * only asks, records that it asked, and reports the refusal in the words the
 * database used.
 */
export async function setTestMark(
  env: Env, table: TestTable, id: string, mark: boolean, byUserId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await run(env.DB, `UPDATE ${table} SET is_test = ? WHERE id = ?`, mark ? 1 : 0, id);
  } catch (err) {
    return { ok: false, message: (err as Error).message || 'That could not be changed.' };
  }
  await audit(env, {
    action: mark ? 'data.marked_test' : 'data.unmarked_test',
    entityType: TEST_TABLES[table],
    entityId: id,
    actorId: byUserId,
    meta: { table },
  });
  return { ok: true };
}

export interface TestTally { table: TestTable; noun: string; count: number }

/** How much test data there is, per kind, for the screen that offers to delete it. */
export async function tallyTestData(env: Env): Promise<TestTally[]> {
  const out: TestTally[] = [];
  for (const table of DELETE_ORDER) {
    const row = await one<{ n: number }>(
      env.DB, `SELECT COUNT(*) AS n FROM ${table} WHERE is_test = 1`);
    out.push({ table, noun: TEST_TABLES[table], count: row?.n ?? 0 });
  }
  return out;
}

export interface TestRecord { table: TestTable; noun: string; id: string; ref: string; title: string }

/**
 * Every marked record, named, for the screen that lists them before taking any.
 *
 * The practice chose to see the list first: *"show a list first, then delete
 * permanently"*. A count alone would be a number somebody presses past.
 */
export async function listTestData(env: Env, limitPerTable = 200): Promise<TestRecord[]> {
  const out: TestRecord[] = [];
  for (const table of DELETE_ORDER) {
    const title = table === 'clients' ? 'full_name'
      : table === 'tasks' ? 'title'
      : table === 'inquiries' ? "COALESCE(subject, '')"
      : 'description';
    const ref = table === 'tasks' ? "''" : 'ref';
    const rows = await all<{ id: string; ref: string; title: string }>(
      env.DB,
      `SELECT id, ${ref} AS ref, COALESCE(${title}, '') AS title
         FROM ${table} WHERE is_test = 1 ORDER BY created_at LIMIT ?`,
      limitPerTable);
    for (const r of rows) out.push({ table, noun: TEST_TABLES[table], ...r });
  }
  return out;
}

export interface Purge { deleted: Record<string, number>; notes: number }

/**
 * Delete everything marked.
 *
 * The file notes go first and by hand: a note is filed by `entity_type` and
 * `entity_id` rather than by a foreign key, so nothing cascades it, and
 * migration 0083 permits it only while the record it names is still there and
 * still marked. Delete the record first and the note becomes undeletable
 * forever — an orphan the register can never tidy.
 *
 * Not wrapped in a transaction, because D1 has no interactive transactions and
 * a batch would not help: each statement is independently correct, and a purge
 * that stops half way has deleted some test data and left the rest marked,
 * which is a state the practice can simply press again from.
 */
export async function purgeTestData(env: Env, byUserId: string): Promise<Purge> {
  let notes = 0;
  for (const [entityType, table] of Object.entries(NOTE_OWNERS)) {
    const result = await run(
      env.DB,
      `DELETE FROM entries
        WHERE entity_type = ?
          AND entity_id IN (SELECT id FROM ${table} WHERE is_test = 1)`,
      entityType);
    notes += result.meta?.changes ?? 0;
  }

  const deleted: Record<string, number> = {};
  for (const table of DELETE_ORDER) {
    const result = await run(env.DB, `DELETE FROM ${table} WHERE is_test = 1`);
    deleted[table] = result.meta?.changes ?? 0;
  }

  // Recorded even though the records are gone. The log is the register's
  // account of what people did, not a copy of the data, and this is one of the
  // larger things a person can do to it.
  await audit(env, {
    action: 'data.test_purged',
    entityType: 'settings',
    entityId: 'test-data',
    actorId: byUserId,
    meta: { ...deleted, file_notes: notes },
  });

  return { deleted, notes };
}
