/**
 * Tags, on matters and on clients.
 *
 * Free-form labels the practice invents as it works. A tag is created the
 * first time someone types it, because a vocabulary you have to ask an
 * administrator to extend is one nobody uses.
 *
 * Names are matched case-insensitively so "AEWV" typed twice is one tag, not
 * two that look identical in a list.
 *
 * **One list of names, two tables of links.** A tag invented on a matter is the
 * same tag on a client — anything else would give the practice two lists to
 * keep in step, and they would not stay in step. The links live in `case_tags`
 * and `client_tags`; the reading and writing below is written once and told
 * which, because two copies of this would drift the first time either changed.
 */

import type { Env } from '../types';
import { all, nowIso, one, run, allByIds } from './db';
import { newId } from './ids';

export type TagColour = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'grey';
export const TAG_COLOURS: TagColour[] = ['neutral', 'green', 'amber', 'red', 'blue', 'grey'];

export interface Tag {
  id: string;
  name: string;
  colour: TagColour;
  created_at: string;
}

/** Normalise what someone typed into a storable tag name. */
export function cleanTagName(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Every tag, with how many records carry it.
 *
 * Counted across matters *and* clients since 8 September 2026. It counted
 * matters alone, which was right when only matters could be tagged and would
 * have shown a tag used on forty clients as "(0)" — a tag that looks unused is
 * a tag somebody deletes.
 */
export async function listTags(env: Env): Promise<Array<Tag & { uses: number }>> {
  return all<Tag & { uses: number }>(
    env.DB,
    `SELECT t.*,
            (SELECT COUNT(*) FROM case_tags ct WHERE ct.tag_id = t.id)
            + (SELECT COUNT(*) FROM client_tags cg WHERE cg.tag_id = t.id) AS uses
       FROM tags t ORDER BY t.name`,
  );
}

/** Which table and column hold the links for a kind of record. */
const LINKS = {
  case: { table: 'case_tags', column: 'case_id' },
  client: { table: 'client_tags', column: 'client_id' },
} as const;

export type TaggableKind = keyof typeof LINKS;

export async function tagsFor(env: Env, kind: TaggableKind, id: string): Promise<Tag[]> {
  const link = LINKS[kind];
  return all<Tag>(
    env.DB,
    `SELECT t.* FROM tags t JOIN ${link.table} x ON x.tag_id = t.id
      WHERE x.${link.column} = ? ORDER BY t.name`,
    id,
  );
}

export async function tagsForCase(env: Env, caseId: string): Promise<Tag[]> {
  return tagsFor(env, 'case', caseId);
}

export async function tagsForClient(env: Env, clientId: string): Promise<Tag[]> {
  return tagsFor(env, 'client', clientId);
}

/**
 * Tags for many cases at once, so a list page costs one query rather than one
 * per row.
 */
export async function tagsForMany(
  env: Env, kind: TaggableKind, ids: string[],
): Promise<Map<string, Tag[]>> {
  const byId = new Map<string, Tag[]>();
  if (ids.length === 0) return byId;
  const link = LINKS[kind];

  // In chunks: a page showing 250 matters would otherwise bind 250 values in
  // one statement, which D1 refuses outright — and the whole page became a 500.
  const rows = await allByIds<Tag & { owner: string }>(env.DB, ids, (placeholders) =>
    `SELECT t.*, x.${link.column} AS owner FROM tags t JOIN ${link.table} x ON x.tag_id = t.id
      WHERE x.${link.column} IN (${placeholders}) ORDER BY t.name`);
  for (const row of rows) {
    const list = byId.get(row.owner) ?? [];
    list.push(row);
    byId.set(row.owner, list);
  }
  return byId;
}

export async function tagsForCases(env: Env, caseIds: string[]): Promise<Map<string, Tag[]>> {
  return tagsForMany(env, 'case', caseIds);
}

export async function tagsForClients(env: Env, clientIds: string[]): Promise<Map<string, Tag[]>> {
  return tagsForMany(env, 'client', clientIds);
}

/** Find a tag by name, or create it. Returns the tag either way. */
export async function findOrCreateTag(
  env: Env,
  name: string,
  createdBy: string | null,
  colour: TagColour = 'neutral',
): Promise<Tag | null> {
  const clean = cleanTagName(name);
  if (!clean) return null;

  const existing = await one<Tag>(env.DB, 'SELECT * FROM tags WHERE name = ?', clean);
  if (existing) return existing;

  const id = newId('tag');
  await run(
    env.DB,
    'INSERT INTO tags (id, name, colour, created_at, created_by) VALUES (?, ?, ?, ?, ?)',
    id, clean, colour, nowIso(), createdBy,
  );
  // Re-read rather than assume: another request may have created the same name
  // between the check and the insert, in which case the unique index wins.
  return one<Tag>(env.DB, 'SELECT * FROM tags WHERE name = ?', clean);
}

export async function attachTag(
  env: Env, kind: TaggableKind, id: string, tagId: string, createdBy: string | null,
): Promise<void> {
  const link = LINKS[kind];
  await run(
    env.DB,
    `INSERT INTO ${link.table} (${link.column}, tag_id, created_at, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(${link.column}, tag_id) DO NOTHING`,
    id, tagId, nowIso(), createdBy,
  );
}

export async function detachTag(
  env: Env, kind: TaggableKind, id: string, tagId: string,
): Promise<void> {
  const link = LINKS[kind];
  await run(env.DB,
    `DELETE FROM ${link.table} WHERE ${link.column} = ? AND tag_id = ?`, id, tagId);
}

export async function tagCase(
  env: Env, caseId: string, tagId: string, createdBy: string | null,
): Promise<void> {
  await attachTag(env, 'case', caseId, tagId, createdBy);
}

export async function untagCase(env: Env, caseId: string, tagId: string): Promise<void> {
  await detachTag(env, 'case', caseId, tagId);
}
