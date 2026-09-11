/**
 * Reading a pile of material into a draft register entry.
 *
 * The ordinary way to open a matter is to type it in, and that way still works
 * exactly as it did. This is the other way: hand over the notes, the email, the
 * INZ letter, the photograph of a passport page, and get the same form back
 * with the boxes already filled.
 *
 * Two rules hold, as everywhere else the model is used:
 *
 *   Nothing is written. What comes back is a form somebody reads, corrects and
 *   submits. The register is unchanged until they press the button.
 *
 *   Nothing is kept that was not asked for. The uploaded file is read in memory
 *   and dropped. It is not stored — there is nowhere to store it until R2 is
 *   switched on — and the extraction deliberately does not pull passport
 *   numbers, because those would then sit in `ai_runs` in the clear.
 */

import type { Env } from '../types';
import { newId } from '../core/ids';
import { caseTypes } from '../core/vocabulary';
import { sha256Hex } from '../core/crypto';
import { nowIso, one, run } from '../core/db';
import { base64Encode } from '../core/ids';
import { getProvider, type IntakeFile, type IntakeResult } from './provider';
import { DOCX_MEDIA_TYPE, docxToText, isDocxArchive } from '../core/docx';

/** What may be uploaded, and how each kind reaches the model. */
const TEXTUAL = [
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json',
  'message/rfc822', 'text/rfc822-headers',
];
const BINARY = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/**
 * Word documents, which are neither. A .docx is a ZIP archive: its bytes are
 * not text and no model reads them, so it is unpacked here and the words go up
 * as text. See `core/docx.ts`. `.doc`, the old binary format, is not read.
 */
const UNPACKED = [DOCX_MEDIA_TYPE];

export const ACCEPTED_UPLOADS = [...TEXTUAL, ...BINARY, ...UNPACKED];

/** 8 MB each: enough for a scanned letter, small enough not to be a weapon. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOADS = 5;

export function describeAccepted(): string {
  return 'Word (.docx), PDF, Text, Markdown, CSV, HTML, JSON, .eml, PNG, JPEG, GIF or WebP.';
}

/**
 * What a kind of file is, in the practice's words, for one this cannot open.
 *
 * Here rather than beside the screen that first needed it, because there is now
 * more than one screen that has to refuse a file: a document already on the
 * matter, and a file in the practice's Google Drive. Two lists of what a media
 * type is called would drift, and the second one would be the one nobody
 * checked. This file already owns what may be read and how big it may be; what
 * to call what may not is the same fact.
 */
export function plainType(type: string): string {
  const known: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'a spreadsheet',
    'application/vnd.ms-excel': 'a spreadsheet',
    'application/vnd.oasis.opendocument.spreadsheet': 'a spreadsheet',
    'application/msword': 'an old-style Word document (.doc)',
    'application/zip': 'a zip folder',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'a slide deck',
  };
  if (known[type]) return known[type]!;
  if (type.startsWith('video/')) return 'a video';
  if (type.startsWith('audio/')) return 'a recording';
  if (type.startsWith('image/')) return 'a picture in a format this cannot open';
  return `a ${type} file`;
}

/**
 * Turn an uploaded file into something a provider can take.
 *
 * The media type is decided here rather than trusted from the browser. For a
 * PDF or a PNG that is because the first bytes are unmistakable and a file
 * claiming to be a PDF that is not would otherwise be forwarded as one. For a
 * Word document it is because the browser's answer comes from the extension,
 * so it is absent as often as it is wrong.
 */
export async function readUpload(file: File): Promise<IntakeFile | { error: string }> {
  const name = file.name || 'attachment';
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `${name} is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return { error: `${name} is empty.` };

  const sniffed = sniff(bytes);
  const claimed = (file.type || '').split(';')[0]!.trim().toLowerCase();
  const mediaType = sniffed ?? claimed;

  if (mediaType === DOCX_MEDIA_TYPE) {
    // Unpacked rather than forwarded: the archive's bytes mean nothing to a
    // model, and the words inside it are all anybody wanted.
    const read = await docxToText(bytes);
    if ('error' in read) return { error: `${name} could not be read — ${read.error}.` };
    return { name, mediaType, text: read.text };
  }
  if (BINARY.includes(mediaType)) {
    return { name, mediaType, data: base64Encode(bytes) };
  }
  if (TEXTUAL.includes(mediaType) || (!mediaType && looksTextual(bytes))) {
    return { name, mediaType: mediaType || 'text/plain', text: new TextDecoder().decode(bytes) };
  }
  return { error: `${name} is a ${mediaType || 'kind of file'} this cannot read. ${describeAccepted()}` };
}

/**
 * What the bytes say the file is, for the formats where guessing wrong matters.
 *
 * Exported because the shortcut endpoint has the same question and no browser
 * to ask: a file arriving from Shortcuts is named by the phone, and a file
 * stored under a type it is not is a file that will be served back wrongly one
 * day. One answer, here, rather than a second copy that drifts.
 */
export function sniff(bytes: Uint8Array): string | null {
  const starts = (...sig: number[]): boolean => sig.every((b, i) => bytes[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';               // %PDF
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  // A Word document has no signature of its own — it is a ZIP, like a
  // spreadsheet or a slide deck — so this one is settled by what is inside.
  if (isDocxArchive(bytes)) return DOCX_MEDIA_TYPE;
  return null;
}

/** A crude but sufficient test: no NUL bytes in the first kilobyte. */
function looksTextual(bytes: Uint8Array): boolean {
  return !bytes.slice(0, 1024).includes(0);
}

export interface IntakeRunRow {
  id: string;
  status: 'ok' | 'error';
  output_json: string | null;
  error: string | null;
  created_at: string;
}

/**
 * What a reading was *for*, when it was for something the register already
 * holds.
 *
 * A reading that opens a matter belongs to nothing yet — that is the point of
 * it — so it is recorded against itself. A reading taken into an existing
 * record belongs to that record, and saying so in `ai_runs` is what lets the
 * review screen refuse a run id that came from somewhere else. Added
 * 11 September 2026 with "Read a document into this matter".
 *
 * **A client joined it on 12 September 2026**, when the practice asked for the
 * same reading on a client's own file: *"as we have a lot of info to add to
 * clients. probably more than we have for cases."* The two are the same act
 * against a different record, so this widened by one word rather than growing
 * a second kind of run — and the scoping the review screen leans on works
 * unchanged, because it compares both halves of the pair.
 */
export interface IntakeSubject {
  entityType: 'case' | 'client';
  entityId: string;
}

export async function runIntake(
  env: Env,
  input: { text: string; files: IntakeFile[] },
  context: { userId: string | null; subject?: IntakeSubject },
): Promise<{ ok: true; result: IntakeResult; runId: string } | { ok: false; error: string }> {
  const provider = await getProvider(env);
  if (!provider) return { ok: false, error: 'The AI layer is not configured. Set AI_PROVIDER and its key.' };

  // The hash covers what was sent, not what came back, so two identical
  // readings are recognisable without keeping the material itself.
  const inputHash = await sha256Hex(
    `${input.text}|${input.files.map((f) => `${f.name}:${f.mediaType}:${(f.data ?? f.text ?? '').length}`).join('|')}`,
  );
  const started = Date.now();
  const id = newId('itk');
  // A reading for a matter is stored against that matter; a reading for nothing
  // yet is stored against itself, as it always was.
  const entityType = context.subject?.entityType ?? 'intake';
  const entityId = context.subject?.entityId ?? id;

  try {
    const types = await caseTypes(env);
    const result = await provider.extract({
      text: input.text, files: input.files, caseTypes: types.map((t) => t.key),
    });
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          output_json, latency_ms, created_at, created_by)
       VALUES (?, 'intake', ?,?, ?,?,?, 'ok', ?,?,?,?)`,
      id, provider.name, provider.model, entityType, entityId, inputHash,
      JSON.stringify(result), Date.now() - started, nowIso(), context.userId,
    );
    return { ok: true, result, runId: id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run(
      env.DB,
      `INSERT INTO ai_runs (id, kind, provider, model, entity_type, entity_id, input_hash, status,
          error, latency_ms, created_at, created_by)
       VALUES (?, 'intake', ?,?, ?,?,?, 'error', ?,?,?,?)`,
      id, provider.name, provider.model, entityType, entityId, inputHash,
      message.slice(0, 500), Date.now() - started, nowIso(), context.userId,
    );
    return { ok: false, error: message };
  }
}

/**
 * Fetch a reading back by its id.
 *
 * Read from the recorded run rather than held in a session or re-run on the
 * next page: it is already stored, so reading it is free, and it cannot quietly
 * change between being shown and being acted on.
 */
export async function latestIntake(env: Env, runId: string): Promise<IntakeResult | null> {
  const row = await one<IntakeRunRow>(
    env.DB, `SELECT * FROM ai_runs WHERE id = ? AND kind = 'intake' AND status = 'ok'`, runId,
  );
  if (!row?.output_json) return null;
  try {
    return JSON.parse(row.output_json) as IntakeResult;
  } catch {
    return null;
  }
}

/**
 * A reading fetched back, but only if it belongs to the record being looked at.
 *
 * `latestIntake` above answers "what did run X say"; this answers "what did run
 * X say *about this matter*", which is the question a review screen has to ask.
 * Without the second half, a run id pasted from another matter's reading would
 * be applied to this one — the record whose fields are about to be written is
 * not the record the reading was taken from, and nobody on the screen could
 * tell.
 */
export async function intakeRunFor(
  env: Env, runId: string, subject: IntakeSubject,
): Promise<{ result: IntakeResult; at: string; by: string } | null> {
  const row = await one<{ output_json: string | null; created_at: string; by_name: string | null }>(
    env.DB,
    `SELECT r.output_json, r.created_at, u.name AS by_name
       FROM ai_runs r LEFT JOIN users u ON u.id = r.created_by
      WHERE r.id = ? AND r.kind = 'intake' AND r.status = 'ok'
        AND r.entity_type = ? AND r.entity_id = ?`,
    runId, subject.entityType, subject.entityId,
  );
  if (!row?.output_json) return null;
  try {
    return {
      result: JSON.parse(row.output_json) as IntakeResult,
      at: row.created_at,
      // Whoever handed it the document. Named in the file note rather than
      // whoever happens to press the button, so the note says where the
      // material came from — and so the note the review shows is the note that
      // is written, whichever of them presses.
      by: row.by_name ?? 'somebody no longer on the register',
    };
  } catch {
    return null;
  }
}
