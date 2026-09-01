/**
 * Filing something that arrived onto the record it belongs to.
 *
 * Three surfaces file — the inbox, inquiries, conversations — and one day an
 * import will too. So the act of filing lives here rather than in whichever
 * route happened to need it first: what the note says, where it goes, and what
 * is written back are one answer, not three that drift.
 *
 * **One fact, one owner**, which is the whole design:
 *
 *   - The **arriving message is the source.** It is never rewritten to match
 *     the note, never edited, never deleted. What arrived is what arrived.
 *   - The **file note on the case or client is the readable copy** — the thing
 *     somebody finds when they open the matter months later.
 *   - `filed_entry_id` ties the two together, so neither has to be guessed at
 *     from a timestamp, and a note can always be traced back to the message it
 *     was made from.
 *
 * The note therefore says where it came from, in its first line, as part of
 * the note's own text. That line is not decoration: a file note is evidence,
 * and evidence whose provenance lives only in a database column is evidence
 * that loses its provenance the first time somebody reads it as a PDF.
 */

import type { Env } from '../types';
import { all, nowIso, one, run } from './db';
import { newId } from './ids';
import { everyOtherTerm, likeTerm, normaliseQuery, otherTermPatterns, searchTerms } from './search';

export type FilingTarget = 'case' | 'client';

export interface FilingRequest {
  target: FilingTarget;
  targetId: string;
  /** What arrived, as it arrived. */
  source: {
    channel: string;
    receivedAt: string | null;
    from: string | null;
    subject: string | null;
    body: string | null;
  };
  /** Where it came from, in words, for the note's first line. */
  origin: string;
  userId: string | null;
}

export interface FilingResult { entryId: string; label: string; at: string }

/** How much of a message goes onto the file. */
const BODY_LIMIT = 20_000;

/**
 * Confirm the destination exists, and name it.
 *
 * Checked here rather than trusted from the form: a filing pointed at an id
 * that does not exist is an item gone from the working list and present on no
 * record — precisely the loss this feature is meant to prevent. Returns null
 * when there is nothing to file onto, and the caller refuses.
 */
export async function filingTargetLabel(
  env: Env, target: FilingTarget, id: string,
): Promise<string | null> {
  if (target === 'case') {
    const row = await one<{ ref: string; title: string }>(
      env.DB, 'SELECT ref, title FROM cases WHERE id = ?', id);
    return row ? `${row.ref} — ${row.title}` : null;
  }
  const row = await one<{ ref: string; full_name: string }>(
    env.DB, 'SELECT ref, full_name FROM clients WHERE id = ?', id);
  return row ? `${row.ref} — ${row.full_name}` : null;
}

/**
 * The note as it will read on the file.
 *
 * Exported so a test can assert the shape without going through a database,
 * and so the routes cannot each invent their own wording.
 */
export function filingNote(source: FilingRequest['source'], origin: string): string {
  const head = `Filed from ${origin}.`;
  const who = source.from ? `From: ${source.from}` : null;
  const when = source.receivedAt ? `Received: ${source.receivedAt.slice(0, 10)}` : null;
  const subject = source.subject ? `Subject: ${source.subject}` : null;
  const body = (source.body ?? '').trim();
  return [
    head,
    [who, when, subject].filter(Boolean).join('\n'),
    body.length > BODY_LIMIT
      // Truncated rather than dropped, and said so. The source still holds all
      // of it, and the note points at the source.
      ? `${body.slice(0, BODY_LIMIT)}\n\n[Shortened on the file. The full message is kept where it arrived.]`
      : body,
  ].filter((part) => part && part.length > 0).join('\n\n');
}

/**
 * Write the note and mark the item filed, as one write.
 *
 * These two have to happen together or not at all. Written as a note first and
 * a mark second, a failure between them leaves a note on the file — permanent,
 * because notes are append-only — with the item still sitting in the queue, so
 * filing it again writes a second copy of the same note. Row-level triggers
 * cannot see across two tables, so the atomicity has to come from the write
 * itself: `batch()` is one statement group, and either both land or neither
 * does.
 *
 * The caller supplies the statement that marks its own row, because only the
 * caller knows which of the three tables it came from.
 */
export async function fileOntoRecord(
  env: Env,
  req: FilingRequest,
  markFiled: (entryId: string, at: string) => D1PreparedStatement,
): Promise<FilingResult | null> {
  const label = await filingTargetLabel(env, req.target, req.targetId);
  if (!label) return null;

  const entryId = newId('ent');
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, pinned, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).bind(
      entryId, req.target, req.targetId,
      // A message somebody received is correspondence, not a system event and
      // not the practice's own note. A filed message read back as a system
      // event would look like the register saying it, rather than a client.
      'message',
      filingNote(req.source, req.origin),
      req.source.receivedAt ?? at,
      at,
      req.userId ?? null,
    ),
    markFiled(entryId, at),
  ]);
  return { entryId, label, at };
}

/** Mark an inbox message filed. The message itself is untouched. */
export function markIngestFiled(
  env: Env, id: string, target: FilingTarget, targetId: string, userId: string | null,
): (entryId: string, at: string) => D1PreparedStatement {
  return (entryId, at) => env.DB.prepare(
    `UPDATE ingest_messages
        SET filed_to_type = ?, filed_to_id = ?, filed_at = ?, filed_by = ?, filed_entry_id = ?
      WHERE id = ?`,
  ).bind(target, targetId, at, userId, entryId, id);
}

/**
 * Mark an inquiry or a conversation filed.
 *
 * These two already carry `client_id` / `case_id`, so filing sets whichever
 * the destination is and leaves the other alone — an inquiry filed onto a
 * matter keeps the client it was already linked to.
 */
export function markLinkedFiled(
  env: Env, table: 'inquiries' | 'channel_threads', id: string,
  target: FilingTarget, targetId: string, userId: string | null,
): (entryId: string, at: string) => D1PreparedStatement {
  const column = target === 'case' ? 'case_id' : 'client_id';
  return (entryId, at) => env.DB.prepare(
    `UPDATE ${table}
        SET ${column} = ?, filed_at = ?, filed_by = ?, filed_entry_id = ?
      WHERE id = ?`,
  ).bind(targetId, at, userId, entryId, id);
}

/**
 * Everywhere something can be filed, as one list.
 *
 * Matters first, because that is where correspondence usually belongs, and a
 * client only when it belongs to the person rather than to a piece of work.
 * Open matters only: filing onto a closed matter is nearly always a mistake,
 * and the closed one is still reachable from the client.
 *
 * The value carries its own kind (`case:ID`), so the form has one control and
 * one button rather than two of each — and the route cannot be handed a case
 * id labelled as a client.
 */
export async function filingOptions(env: Env): Promise<Array<{ value: string; label: string }>> {
  const [cases, clients] = await Promise.all([
    all<{ id: string; ref: string; title: string; client_name: string }>(
      env.DB,
      `SELECT k.id, k.ref, k.title, cl.full_name AS client_name
         FROM cases k JOIN clients cl ON cl.id = k.client_id
        WHERE k.status NOT IN ('closed', 'withdrawn')
        ORDER BY k.ref DESC LIMIT 500`),
    all<{ id: string; ref: string; full_name: string }>(
      env.DB,
      `SELECT id, ref, full_name FROM clients
        WHERE status <> 'archived' ORDER BY full_name LIMIT 500`),
  ]);
  return [
    ...cases.map((k) => ({ value: `case:${k.id}`, label: `${k.ref} — ${k.title} (${k.client_name})` })),
    ...clients.map((cl) => ({ value: `client:${cl.id}`, label: `${cl.ref} — ${cl.full_name}` })),
  ];
}

/**
 * The matters and clients matching what somebody typed.
 *
 * `filingOptions` above puts the whole register in one dropdown, which was fine
 * at sixty records and is not fine at four hundred: a list nobody can scan is a
 * list people file into wrongly. This searches instead, over everything an
 * email might be identified by — the matter's reference, description and
 * summary, the client's name, and the INZ application and client numbers, which
 * is how a letter from INZ names the file it is about.
 *
 * Closed and withdrawn matters are included and marked. The dropdown left them
 * out because you rarely file onto a closed file; but a decision letter on a
 * matter closed last week is exactly the thing you do file, and leaving it out
 * means the search says "no such matter" about a matter that plainly exists.
 */
export interface FilingHit {
  value: string;
  ref: string;
  title: string;
  detail: string;
  closed: boolean;
}

export async function filingSearch(
  env: Env, rawQuery: string, limit = 12,
): Promise<FilingHit[]> {
  const q = normaliseQuery(rawQuery);
  // One character matches most of the register and answers nothing.
  if (q.length < 2) return [];
  const upper = q.toUpperCase();
  // Every word, in any order — the same rule as everywhere else, and the reason
  // "NGUYEN Minh Khuong" finds a client stored as "Minh Khuong NGUYEN". `like`
  // is the first word; the phrase is only used for the exact-reference test.
  const terms = searchTerms(q);
  const like = likeTerm(terms[0] ?? q);
  const rest = otherTermPatterns(terms);

  const [cases, clients] = await Promise.all([
    all<{ id: string; ref: string; title: string; descriptor: string | null; status: string;
          inz_application_number: string | null; client_name: string | null }>(
      env.DB,
      `SELECT k.id, k.ref, k.title, k.descriptor, k.status, k.inz_application_number,
              cl.full_name AS client_name
         FROM cases k LEFT JOIN clients cl ON cl.id = k.client_id
        WHERE (k.ref LIKE ?1 ESCAPE '\\' OR k.title LIKE ?1 ESCAPE '\\'
           OR k.descriptor LIKE ?1 ESCAPE '\\' OR k.summary LIKE ?1 ESCAPE '\\'
           OR k.inz_application_number LIKE ?1 ESCAPE '\\'
           OR k.inz_client_number LIKE ?1 ESCAPE '\\'
           OR cl.full_name LIKE ?1 ESCAPE '\\')${
             everyOtherTerm(['k.ref', 'k.title', 'k.descriptor', 'k.summary',
                             'k.inz_application_number', 'k.inz_client_number',
                             'cl.full_name'], terms, 4)}
        ORDER BY CASE WHEN k.ref = ?2 THEN 0 ELSE 1 END,
                 CASE WHEN k.status IN ('closed', 'withdrawn') THEN 1 ELSE 0 END,
                 k.updated_at DESC
        LIMIT ?3`, like, upper, limit, ...rest),
    all<{ id: string; ref: string; full_name: string; email: string | null; status: string }>(
      env.DB,
      `SELECT id, ref, full_name, email, status FROM clients
        WHERE (ref LIKE ?1 ESCAPE '\\' OR full_name LIKE ?1 ESCAPE '\\'
           OR family_name LIKE ?1 ESCAPE '\\' OR given_names LIKE ?1 ESCAPE '\\'
           OR preferred_name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\'
           OR phone LIKE ?1 ESCAPE '\\' OR nzbn LIKE ?1 ESCAPE '\\')${
             everyOtherTerm(['ref', 'full_name', 'family_name', 'given_names',
                             'preferred_name', 'email', 'phone', 'nzbn'], terms, 4)}
        ORDER BY CASE WHEN ref = ?2 THEN 0 ELSE 1 END, full_name
        LIMIT ?3`, like, upper, limit, ...rest),
  ]);

  // Matters first: an email is about a matter more often than about a person,
  // and when it is about a person their file is a short scroll further down.
  return [
    ...cases.map((k) => ({
      value: `case:${k.id}`,
      ref: k.ref,
      title: k.descriptor || k.title,
      detail: [k.client_name, k.inz_application_number].filter(Boolean).join(' · '),
      closed: k.status === 'closed' || k.status === 'withdrawn',
    })),
    ...clients.map((cl) => ({
      value: `client:${cl.id}`,
      ref: cl.ref,
      title: cl.full_name,
      detail: cl.email ?? '',
      closed: cl.status === 'archived',
    })),
  ];
}

/** Split `case:ID` back into its two halves, refusing anything else. */
export function parseFilingChoice(
  value: string | null | undefined,
): { target: FilingTarget; targetId: string } | null {
  const at = (value ?? '').indexOf(':');
  if (at <= 0) return null;
  const target = value!.slice(0, at);
  const targetId = value!.slice(at + 1);
  if (target !== 'case' && target !== 'client') return null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(targetId)) return null;
  return { target, targetId };
}

/**
 * Undo a filing.
 *
 * The item returns to the working list. The note stays on the file: the audit
 * log and file notes are append-only, and a note that was written is a thing
 * that happened. Unfiling says "this was put in the wrong place"; it does not
 * pretend nobody ever put it there.
 */
export async function unfile(
  env: Env, table: 'ingest_messages' | 'inquiries' | 'channel_threads', id: string,
): Promise<{ orphanedEntryId: string | null }> {
  // Read the link before clearing it, and hand it back so the audit entry can
  // name the note that is now on a file with nothing pointing at it. Without
  // this the log says only "unfiled" — and the note, which cannot be removed,
  // becomes untraceable to what it came from. This feature exists to keep an
  // evidence chain; dropping the last link in it on the way out would be odd.
  const before = await one<{ filed_entry_id: string | null }>(
    env.DB, `SELECT filed_entry_id FROM ${table} WHERE id = ?`, id);
  const extra = table === 'ingest_messages' ? ', filed_to_type = NULL, filed_to_id = NULL' : '';
  await run(
    env.DB,
    `UPDATE ${table} SET filed_at = NULL, filed_by = NULL, filed_entry_id = NULL${extra} WHERE id = ?`,
    id,
  );
  return { orphanedEntryId: before?.filed_entry_id ?? null };
}
