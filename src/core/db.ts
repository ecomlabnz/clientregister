/** Thin D1 helpers. Every query in the app goes through prepared statements. */

import type { Env } from '../types';

export function nowIso(): string {
  return new Date().toISOString();
}

export async function one<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

/**
 * The most bound values one statement may carry.
 *
 * D1 refuses a statement with too many, and the refusal is a 500 rather than a
 * short page: "too many SQL variables". The Cases list hit it the moment the
 * register held enough matters to show 250 at once — 250 ids in one `IN`.
 *
 * Ninety rather than the hundred D1 allows, so a caller adding a parameter
 * beside the list does not tip it over.
 */
export const MAX_BOUND_VALUES = 90;

/**
 * Run a query whose `IN (...)` list comes from the caller, in chunks.
 *
 * The list is the only thing bound, which is true of every caller: a page has
 * some ids and wants the tags, nationalities or settings belonging to them. The
 * SQL is built by the caller from the placeholders it is handed, so the shape
 * of the query stays where it is read.
 *
 * A page of 250 becomes three statements instead of one that D1 will not run.
 */
export async function allByIds<T>(
  db: D1Database, ids: readonly string[], sql: (placeholders: string) => string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += MAX_BOUND_VALUES) {
    const chunk = ids.slice(i, i + MAX_BOUND_VALUES);
    out.push(...await all<T>(db, sql(chunk.map(() => '?').join(',')), ...chunk));
  }
  return out;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

export async function count(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const row = await one<{ n: number }>(db, sql, ...params);
  return row?.n ?? 0;
}

/**
 * Allocate the next human-readable reference for a counter, atomically.
 * `nextRef(db, 'case', 'CASE')` -> "CASE-0007".
 */
export async function nextRef(db: D1Database, counter: string, prefix: string): Promise<string> {
  const row = await one<{ value: number }>(
    db,
    'UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value',
    counter,
  );
  if (!row) throw new Error(`unknown counter: ${counter}`);
  return `${prefix}-${String(row.value).padStart(4, '0')}`;
}

/**
 * A reference that restarts each year: `CASE-26-001`.
 *
 * The year is worth carrying in the number. A practice's files are talked about
 * by year — "that was a 2025 matter" — and a bare sequence tells you nothing
 * about when something was opened without looking it up. Three digits is a
 * thousand matters in a year, which is more than a small practice will open.
 *
 * Each year gets its own counter row, created the first time that year is
 * needed. Allocation is still a single atomic UPDATE, so two matters opened in
 * the same second cannot take the same number.
 */
export async function nextYearlyRef(
  db: D1Database, counter: string, prefix: string, year = new Date().getFullYear(),
): Promise<string> {
  const name = `${counter}:${year}`;
  // INSERT OR IGNORE then UPDATE, rather than a read followed by a write: the
  // read-then-write is where two requests in the same second collide.
  await db.prepare('INSERT OR IGNORE INTO counters (name, value) VALUES (?, 0)').bind(name).run();
  const row = await one<{ value: number }>(
    db, 'UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value', name,
  );
  if (!row) throw new Error(`could not allocate a reference for ${name}`);
  return `${prefix}-${String(year).slice(-2)}-${String(row.value).padStart(3, '0')}`;
}

/** Read a settings row, falling back to `fallback` when unset. */
export async function getSetting(env: Env, key: string, fallback = ''): Promise<string> {
  const row = await one<{ value: string }>(env.DB, 'SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? fallback;
}

export async function setSetting(env: Env, key: string, value: string, byUserId?: string): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                    updated_at = excluded.updated_at,
                                    updated_by = excluded.updated_by`,
    key, value, nowIso(), byUserId ?? null,
  );
}

export async function getBoolSetting(env: Env, key: string, fallback = false): Promise<boolean> {
  const raw = await getSetting(env, key, fallback ? 'true' : 'false');
  return raw === 'true' || raw === '1';
}
