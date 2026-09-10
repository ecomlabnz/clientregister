/**
 * The files an intake reading was given, between being read and being used.
 *
 * "Open a matter from what you already have" reads an upload, proposes a
 * client and a matter, and waits for somebody to press the button. The reading
 * happens first and the record exists only after the press — so between the two
 * the file has nowhere to live: `documents.entity_id` points at a record, and
 * there is no record yet.
 *
 * Until 8 September 2026 the answer was to drop it. The page said so in bold,
 * and the reason it gave — that R2 was not switched on — stopped being true on
 * 29 August. What was being dropped was the IEA letter, the job token, the
 * decision letter: the document the matter was being opened *from*.
 *
 * So it is staged. The bytes go to R2 at once under a key naming the reading;
 * this table remembers them; and the press that opens the matter writes a
 * `documents` row for **the same object** — no copy, the same bytes, the same
 * key. What is left over is a reading nobody acted on, and `sweepStaged` below
 * clears those.
 */

import type { Env } from '../types';
import { all, nowIso, run } from './db';
import { newId } from './ids';
import { putFile, safeFilename } from './files';

/** How long a staged file waits for somebody to press the button. */
export const STAGED_FILE_DAYS = 7;

export interface StagedUpload {
  id: string;
  run_id: string;
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
 * Keep one uploaded file against a reading.
 *
 * Returns null when there is nowhere to put it — no bucket bound — rather than
 * throwing: a reading that worked must not fail at the last step because
 * storage is off. The caller says so on the page instead.
 */
export async function stageUpload(
  env: Env,
  opts: { runId: string; file: File; contentType: string; userId: string | null },
): Promise<StagedUpload | null> {
  if (!env.DOCS) return null;
  const id = newId('iup');
  // The reading in the key, so everything one reading staged can be found in
  // the bucket by prefix even if this table were lost.
  const key = `intake/${opts.runId}/${id}-${safeFilename(opts.file.name || 'attachment')}`;
  const put = await putFile(env.DOCS, {
    key, file: opts.file, uploadedBy: opts.userId, contentType: opts.contentType,
  });
  const at = nowIso();
  await run(
    env.DB,
    `INSERT INTO intake_uploads (id, run_id, r2_key, filename, content_type, size_bytes,
        sha256, uploaded_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, opts.runId, key, safeFilename(opts.file.name || 'attachment'),
    put.contentType, put.size, put.digest, at, opts.userId,
  );
  return {
    id, run_id: opts.runId, r2_key: key,
    filename: safeFilename(opts.file.name || 'attachment'),
    content_type: put.contentType, size_bytes: put.size, sha256: put.digest,
    uploaded_at: at, document_id: null, attached_at: null,
  };
}

/** What one reading staged and has not yet put on a record. */
export async function stagedFor(env: Env, runId: string): Promise<StagedUpload[]> {
  return all<StagedUpload>(
    env.DB,
    `SELECT * FROM intake_uploads WHERE run_id = ? AND attached_at IS NULL
      ORDER BY uploaded_at, id`,
    runId);
}

/**
 * Put everything a reading staged onto the record it produced.
 *
 * The R2 object is not moved or copied: the `documents` row points at the same
 * key. Copying would double the storage and give two objects that could drift;
 * moving would mean a window where neither row's key resolves.
 *
 * Written one at a time rather than in a batch, and the `documents` row goes in
 * before the staging row is marked: a failure between them leaves a document on
 * the file and a staged row that still looks unused, which the sweep would
 * delete — so the sweep only deletes what is *older than a week*, by which time
 * such a row has been noticed, and never deletes the object of an attached one.
 *
 * Returns how many landed, so the caller can say so.
 */
export async function attachStagedTo(
  env: Env,
  opts: {
    runId: string;
    entityType: 'client' | 'case' | 'inquiry' | 'quote';
    entityId: string;
    userId: string | null;
    description: string;
  },
): Promise<number> {
  const staged = await stagedFor(env, opts.runId);
  let landed = 0;
  for (const file of staged) {
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
      'UPDATE intake_uploads SET document_id = ?, attached_at = ? WHERE id = ?',
      documentId, at, file.id,
    );
    landed += 1;
  }
  return landed;
}

/**
 * The documents already on the file that a reading was taken from.
 *
 * **Asked for on 11 September 2026:** *"we need to make it easier for the
 * client - so they email us docs and we extract the data with AI systems. much
 * easier on the client."*
 *
 * The two halves of this file are the two states a document a reading read can
 * be in. Everything above is a file that has **no** `documents` row yet — an
 * upload, staged until the press that puts it on the record. This is the other
 * one: a file that was already on the matter, emailed in by the client and
 * filed there, which the reading does not stage, does not copy and does not
 * attach again. All it records is that it read it, because the review screen
 * and the append-only file note both have to be able to say so afterwards, and
 * a list carried in a URL between the two would be a claim rather than a fact.
 *
 * Which documents a matter may read is decided by one SQL clause in
 * `modules/documents` (`CASE_READING_SOURCES`) — this records the answer, it
 * does not second-guess it.
 */
export interface DocumentRead {
  document_id: string;
  filename: string;
  read_at: string;
}

export async function recordDocumentRead(
  env: Env, opts: { runId: string; documentId: string },
): Promise<void> {
  await run(
    env.DB,
    // OR IGNORE because the key is (run, document): the same document ticked
    // twice on one press is one reading of one set of bytes.
    'INSERT OR IGNORE INTO ai_run_documents (run_id, document_id, read_at) VALUES (?,?,?)',
    opts.runId, opts.documentId, nowIso(),
  );
}

/** What one reading read off the file, oldest first, by name. */
export async function documentsReadBy(env: Env, runId: string): Promise<DocumentRead[]> {
  return all<DocumentRead>(
    env.DB,
    `SELECT r.document_id, r.read_at, d.filename
       FROM ai_run_documents r JOIN documents d ON d.id = r.document_id
      WHERE r.run_id = ? ORDER BY r.read_at, d.filename`,
    runId);
}

/**
 * The third state a file a reading read can be in: read, and thrown away.
 *
 * **Asked for on 11 September 2026:** *"could they be fetched, read, case
 * created and they are then discarded from the system to only remain in the
 * gdrive?"* — with the refinement *"throw away by default, tick to keep"*.
 *
 * The two halves above are the two states a file with bytes in the register can
 * be in. A file in the practice's Google Drive is in neither: the bytes are
 * fetched, read and dropped, and what is left on the matter is an address. So a
 * drive read records what the reading needs to be able to say afterwards — the
 * name, the kind, the address, and whether the practice ticked to keep a copy —
 * and nothing else. See migration 0086 for why this is a table rather than a
 * hidden field on the review screen.
 *
 * A ticked "keep a copy" is *not* handled here. That file is staged exactly as
 * an upload is, by `stageUpload` above, and lands on the matter by
 * `attachStagedTo` with the same press. One way for bytes to reach a matter,
 * not two.
 */
export interface DriveRead {
  id: string;
  run_id: string;
  file_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  web_url: string;
  kept: number;
  read_at: string;
  document_id: string | null;
  linked_at: string | null;
}

export async function recordDriveRead(
  env: Env,
  opts: {
    runId: string; fileId: string; filename: string; contentType: string;
    sizeBytes: number; webUrl: string; keep: boolean;
  },
): Promise<void> {
  await run(
    env.DB,
    // OR IGNORE on the (run, file) uniqueness: the same drive file ticked twice
    // on one press is one reading of one set of bytes.
    `INSERT OR IGNORE INTO drive_reads (id, run_id, file_id, filename, content_type,
        size_bytes, web_url, kept, read_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    newId('dvr'), opts.runId, opts.fileId, safeFilename(opts.filename), opts.contentType,
    opts.sizeBytes, opts.webUrl, opts.keep ? 1 : 0, nowIso(),
  );
}

/** What one reading took out of the drive, oldest first. */
export async function driveReadsBy(env: Env, runId: string): Promise<DriveRead[]> {
  return all<DriveRead>(
    env.DB, 'SELECT * FROM drive_reads WHERE run_id = ? ORDER BY read_at, filename', runId);
}

/** Mark a drive read as having become a document on the matter. */
export async function markDriveReadLinked(
  env: Env, id: string, documentId: string,
): Promise<void> {
  await run(env.DB, 'UPDATE drive_reads SET document_id = ?, linked_at = ? WHERE id = ?',
            documentId, nowIso(), id);
}

/**
 * Delete the files of readings nobody acted on.
 *
 * Run nightly. A reading that was never applied leaves its uploads in R2 with
 * nothing pointing at them, and those are client documents — keeping them
 * indefinitely because a page was closed is the kind of quiet accumulation that
 * makes a register impossible to reason about.
 *
 * Only rows never attached, and only after a week. The object goes first: a
 * row whose object is gone is a broken link the sweep will clear next time,
 * where a deleted row whose object survives is an orphan nothing will ever
 * find.
 */
export async function sweepStaged(env: Env, days = STAGED_FILE_DAYS): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const stale = await all<{ id: string; r2_key: string }>(
    env.DB,
    'SELECT id, r2_key FROM intake_uploads WHERE attached_at IS NULL AND uploaded_at < ? LIMIT 200',
    cutoff);
  let gone = 0;
  for (const file of stale) {
    if (env.DOCS) await env.DOCS.delete(file.r2_key);
    await run(env.DB, 'DELETE FROM intake_uploads WHERE id = ? AND attached_at IS NULL', file.id);
    gone += 1;
  }
  return gone;
}
