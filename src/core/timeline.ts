/**
 * The shared timeline. Clients, cases, inquiries and quotes all hang their
 * history off one table, so "what happened on this matter" is a single query
 * and new record types get history for free.
 */

import type { EntityType, Env } from '../types';
import type { EntryKind } from '../domain';
import { all, nowIso, run } from './db';
import { newId } from './ids';

export interface Entry {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  kind: EntryKind;
  body: string;
  occurred_at: string;
  pinned: number;
  created_at: string;
  created_by: string | null;
  author_name?: string | null;
  /** An attached file, once R2 is enabled. */
  document_id?: string | null;
  document_name?: string | null;
  /** Set when the note was corrected inside its window. See below. */
  edited_at?: string | null;
}

/**
 * How long a note may be corrected for after it is written.
 *
 * Notes are append-only and stay that way: a file note that can be edited
 * months later is not a record of what happened, it is a record of what
 * somebody now wishes had happened, and it is worth nothing in a complaint or
 * a Tribunal appeal. What this admits is narrower — for the first few minutes a
 * note is not yet a record anybody has relied on. It is the sentence just
 * typed, with the wrong date in it, still on the screen. Refusing that
 * correction does not protect the file; it puts a wrong date on it forever and
 * a second note underneath explaining the first.
 *
 * The window is enforced by the database, not by this number: migration 0052
 * carries the same five minutes in a trigger, so a correction from the D1
 * console is refused too. This is what the screen uses to decide whether to
 * offer the button.
 */
export const CORRECTION_WINDOW_MINUTES = 5;

/** Whether this note may still be corrected, and by this person. */
export function correctable(
  entry: Pick<Entry, 'created_at' | 'created_by' | 'kind'> & { edited_at?: string | null },
  byUserId: string | null,
  now = Date.now(),
): boolean {
  // A note the register wrote about itself is not somebody's slip to fix.
  if (entry.kind === 'system') return false;
  // Once. A note that has been corrected stands as it is.
  if (entry.edited_at) return false;
  // The person who wrote it. Correcting somebody else's note is not a
  // correction, it is a rewrite.
  if (!byUserId || entry.created_by !== byUserId) return false;
  const written = Date.parse(entry.created_at);
  if (Number.isNaN(written)) return false;
  const elapsed = now - written;
  return elapsed >= 0 && elapsed <= CORRECTION_WINDOW_MINUTES * 60_000;
}

/**
 * Correct a note inside its window.
 *
 * The previous text goes to the audit log, which is append-only without
 * exception — so even a correction made within seconds leaves the original
 * answerable. Returns what the note said before, for the audit record the
 * caller writes, or null when the database refused.
 */
export async function correctEntry(
  env: Env,
  input: { id: string; body: string; kind: EntryKind; occurredAt: string; byUserId: string },
): Promise<{ was: { body: string; kind: string; occurred_at: string } } | { error: string }> {
  const before = await all<Entry>(
    env.DB, 'SELECT * FROM entries WHERE id = ?', input.id,
  );
  const entry = before[0];
  if (!entry) return { error: 'That note no longer exists.' };
  if (!correctable(entry, input.byUserId)) {
    return { error: `A note can be corrected only within ${CORRECTION_WINDOW_MINUTES} minutes of writing it, and only once.` };
  }
  try {
    await run(
      env.DB,
      `UPDATE entries SET body = ?, kind = ?, occurred_at = ?, edited_at = ? WHERE id = ?`,
      input.body, input.kind, input.occurredAt, nowIso(), input.id,
    );
  } catch {
    // The trigger is the authority, and it has just disagreed with the check
    // above — a clock that moved, or two people at once. Its answer stands.
    return { error: `A note can be corrected only within ${CORRECTION_WINDOW_MINUTES} minutes of writing it, and only once.` };
  }
  return { was: { body: entry.body, kind: entry.kind, occurred_at: entry.occurred_at } };
}

export async function addEntry(
  env: Env,
  input: {
    entityType: EntityType;
    entityId: string;
    kind: EntryKind;
    body: string;
    occurredAt?: string;
    createdBy?: string | null;
    pinned?: boolean;
    documentId?: string | null;
  },
): Promise<string> {
  const id = newId('ent');
  await run(
    env.DB,
    `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, pinned, created_at, created_by, document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.entityType,
    input.entityId,
    input.kind,
    input.body,
    input.occurredAt ?? nowIso(),
    input.pinned ? 1 : 0,
    nowIso(),
    input.createdBy ?? null,
    input.documentId ?? null,
  );
  return id;
}

export async function listEntries(
  env: Env,
  entityType: EntityType,
  entityId: string,
  limit = 100,
): Promise<Entry[]> {
  return all<Entry>(
    env.DB,
    `SELECT e.*, u.name AS author_name, d.filename AS document_name
       FROM entries e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN documents d ON d.id = e.document_id
      WHERE e.entity_type = ? AND e.entity_id = ?
      ORDER BY e.pinned DESC, e.occurred_at DESC
      LIMIT ?`,
    entityType, entityId, limit,
  );
}

/** Convenience for recording an automatic, non-user event. */
export async function systemEntry(
  env: Env,
  entityType: EntityType,
  entityId: string,
  body: string,
  createdBy?: string | null,
): Promise<void> {
  await addEntry(env, { entityType, entityId, kind: 'system', body, createdBy: createdBy ?? null });
}
