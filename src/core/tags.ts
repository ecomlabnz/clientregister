/**
 * Case tags.
 *
 * Free-form labels the practice invents as it works. A tag is created the
 * first time someone types it, because a vocabulary you have to ask an
 * administrator to extend is one nobody uses.
 *
 * Names are matched case-insensitively so "AEWV" typed twice is one tag, not
 * two that look identical in a list.
 */

import type { Env } from '../types';
import { all, nowIso, one, run } from './db';
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

export async function listTags(env: Env): Promise<Array<Tag & { uses: number }>> {
  return all<Tag & { uses: number }>(
    env.DB,
    `SELECT t.*, (SELECT COUNT(*) FROM case_tags ct WHERE ct.tag_id = t.id) AS uses
       FROM tags t ORDER BY t.name`,
  );
}

export async function tagsForCase(env: Env, caseId: string): Promise<Tag[]> {
  return all<Tag>(
    env.DB,
    `SELECT t.* FROM tags t JOIN case_tags ct ON ct.tag_id = t.id
      WHERE ct.case_id = ? ORDER BY t.name`,
    caseId,
  );
}

/**
 * Tags for many cases at once, so a list page costs one query rather than one
 * per row.
 */
export async function tagsForCases(env: Env, caseIds: string[]): Promise<Map<string, Tag[]>> {
  const byCase = new Map<string, Tag[]>();
  if (caseIds.length === 0) return byCase;

  const placeholders = caseIds.map(() => '?').join(',');
  const rows = await all<Tag & { case_id: string }>(
    env.DB,
    `SELECT t.*, ct.case_id FROM tags t JOIN case_tags ct ON ct.tag_id = t.id
      WHERE ct.case_id IN (${placeholders}) ORDER BY t.name`,
    ...caseIds,
  );
  for (const row of rows) {
    const list = byCase.get(row.case_id) ?? [];
    list.push(row);
    byCase.set(row.case_id, list);
  }
  return byCase;
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

export async function tagCase(
  env: Env, caseId: string, tagId: string, createdBy: string | null,
): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO case_tags (case_id, tag_id, created_at, created_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(case_id, tag_id) DO NOTHING`,
    caseId, tagId, nowIso(), createdBy,
  );
}

export async function untagCase(env: Env, caseId: string, tagId: string): Promise<void> {
  await run(env.DB, 'DELETE FROM case_tags WHERE case_id = ? AND tag_id = ?', caseId, tagId);
}
