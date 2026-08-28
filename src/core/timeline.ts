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
