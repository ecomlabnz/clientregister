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
