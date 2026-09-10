/**
 * The files that arrive with something in the inbox, between arriving and
 * being filed.
 *
 * The same problem `core/intakefiles.ts` solved for the intake reader, and the
 * same answer. A file sent in by an Apple Shortcut belongs to nobody yet:
 * nobody has said which client it is for. `documents.entity_id` points at a
 * record, and at the moment the file lands there is no record to point at.
 *
 * So the bytes go into R2 at once, this table remembers them against the inbox
 * item they came with, and the press that files that item onto a client or a
 * matter writes a `documents` row for **the same object** — no copy, the same
 * bytes, the same key. The routine then finishes itself: shortcut → inbox →
 * file to matter → read.
 *
 * **Nothing sweeps these away on a timer**, unlike a staged intake upload. A
 * reading nobody acted on is an abandoned draft; an inbox item is the
 * register's record that something arrived. Its files go when it goes — see
 * `dropInboxUploads`, which the delete routes call — and not before.
 */

import type { Env } from '../types';
import { all, nowIso, run } from './db';
import { newId } from './ids';
import { putFile, safeFilename } from './files';

export interface InboxUpload {
  id: string;
  message_id: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string | null;
  uploaded_at: string;
  document_id: string | null;
  attached_at: string | null;
}

/**
 * Keep one file against the inbox item it arrived with.
 *
 * Returns null when there is nowhere to put it — no bucket bound — rather than
 * throwing, so an upload that has already been captured is not lost at the last
 * step because storage is off. The caller says so in its answer.
 */
export async function stageInboxUpload(
  env: Env,
  opts: { messageId: string; file: File; contentType: string; userId: string | null },
): Promise<InboxUpload | null> {
  if (!env.DOCS) return null;
  const id = newId('inu');
  const filename = safeFilename(opts.file.name || 'attachment');
  // The message in the key, so everything one arrival brought can be found in
  // the bucket by prefix even if this table were lost.
  const key = `inbox/${opts.messageId}/${id}-${filename}`;
  const put = await putFile(env.DOCS, {
    key, file: opts.file, uploadedBy: opts.userId, contentType: opts.contentType,
  });
  const at = nowIso();
  await run(
    env.DB,
    `INSERT INTO inbox_uploads (id, message_id, r2_key, filename, content_type, size_bytes,
        sha256, uploaded_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, opts.messageId, key, filename, put.contentType, put.size, put.digest, at, opts.userId,
  );
  return {
    id, message_id: opts.messageId, r2_key: key, filename,
    content_type: put.contentType, size_bytes: put.size, sha256: put.digest,
    uploaded_at: at, document_id: null, attached_at: null,
  };
}

/** Everything one inbox item brought, whether or not it is on a record yet. */
export async function inboxUploadsFor(env: Env, messageId: string): Promise<InboxUpload[]> {
  return all<InboxUpload>(
    env.DB,
    `SELECT id, message_id, r2_key, filename, content_type, size_bytes, sha256,
            uploaded_at, document_id, attached_at
       FROM inbox_uploads WHERE message_id = ? ORDER BY uploaded_at, id`,
    messageId);
}

/**
 * Put everything an inbox item brought onto the record it was filed on.
 *
 * The R2 object is not moved or copied: the `documents` row points at the same
 * key. Copying would double the storage and give two objects that could drift;
 * moving would leave a window in which neither row's key resolves.
 *
 * The `documents` row goes in before the staging row is marked, and the
 * staging row is never deleted by this — so a failure between the two leaves a
 * document on the file and a row that still looks unattached, which is a
 * duplicate somebody can see rather than a file nobody can find.
 *
 * Returns how many landed, so the caller can say so.
 */
export async function attachInboxUploadsTo(
  env: Env,
  opts: {
    messageId: string;
    entityType: 'client' | 'case';
    entityId: string;
    userId: string | null;
    description: string;
  },
): Promise<number> {
  const waiting = (await inboxUploadsFor(env, opts.messageId)).filter((f) => !f.attached_at);
  let landed = 0;
  for (const file of waiting) {
    const documentId = newId('doc');
    const at = nowIso();
    await run(
      env.DB,
      `INSERT INTO documents (id, entity_type, entity_id, r2_key, filename, content_type,
          size_bytes, sha256, description, uploaded_at, uploaded_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      documentId, opts.entityType, opts.entityId, file.r2_key, file.filename,
      file.content_type, file.size_bytes, file.sha256, opts.description, at, opts.userId,
    );
    await run(
      env.DB,
      'UPDATE inbox_uploads SET document_id = ?, attached_at = ? WHERE id = ?',
      documentId, at, file.id,
    );
    landed += 1;
  }
  return landed;
}

/**
 * Delete the bytes of files an inbox item brought that never reached a record.
 *
 * Called before the message row goes. Deleting a captured message is the
 * practice saying it should not hold what arrived — *"a client sent something
 * the practice has no business holding"* — and a file left in the bucket would
 * contradict that. The rows themselves go with the message, by the foreign key.
 *
 * A file that **has** been put on a record is left exactly where it is: the
 * `documents` row on the client or the matter now owns those bytes, and the
 * message being deleted says nothing about the document that came out of it.
 */
export async function dropInboxUploads(env: Env, messageIds: string[]): Promise<number> {
  let gone = 0;
  for (const messageId of messageIds) {
    for (const file of await inboxUploadsFor(env, messageId)) {
      if (file.attached_at) continue;
      if (env.DOCS) await env.DOCS.delete(file.r2_key);
      gone += 1;
    }
  }
  return gone;
}
