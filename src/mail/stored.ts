/**
 * Reading back what was sent.
 *
 * `queue.ts` writes an email and sends it. Nothing until now read one back, and
 * that is what the practice noticed on 11 September 2026, looking at a file
 * note about a quotation that had gone out: *"files notes in quotations? why do
 * we not have the entire email that was sent out in the file note, recorded as
 * an email?"*
 *
 * The whole letter was already in the register — `outbound_emails` keeps the
 * recipients, the subject, both bodies, the reply-to, the status and the
 * attachments — but the file note carried only a summary of it and no screen
 * anywhere rendered the row. So the answer was not to record anything new. It
 * was to open what was already there.
 *
 * **Nothing here writes.** These are the queries the viewer and the record
 * pages use, plus the rule that decides which stored email a file note is
 * talking about. That rule runs at render time and matches on what the note
 * says, deliberately: file notes are append-only, so an email sent months ago
 * — before any of this existed — becomes readable the moment the page is drawn,
 * without one word of a single note being rewritten.
 */

import type { Env } from '../types';
import { all, allByIds, one } from '../core/db';

/** One row of `outbound_emails`, with the name of whoever pressed send. */
export interface StoredEmail {
  id: string;
  to_addr: string;
  cc_addr: string | null;
  bcc_addr: string | null;
  reply_to: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  status: string;
  provider: string | null;
  provider_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  created_by: string | null;
  attachment_ids: string | null;
  /** Null when the register sent it of its own accord — an acceptance letter. */
  author_name: string | null;
}

const COLUMNS = `e.id, e.to_addr, e.cc_addr, e.bcc_addr, e.reply_to, e.subject, e.body_text,
                 e.body_html, e.status, e.provider, e.provider_id, e.entity_type, e.entity_id,
                 e.error, e.created_at, e.sent_at, e.created_by, e.attachment_ids,
                 u.name AS author_name`;

export async function storedEmail(env: Env, id: string): Promise<StoredEmail | null> {
  return one<StoredEmail>(
    env.DB,
    `SELECT ${COLUMNS} FROM outbound_emails e
       LEFT JOIN users u ON u.id = e.created_by
      WHERE e.id = ?`,
    id,
  );
}

/**
 * Every email sent for one record, newest first.
 *
 * Matched on the entity the queue recorded at the time — `entity_type` and
 * `entity_id`, which is what `idx_outbound_entity` is indexed on. A quotation's
 * covering letter and the two acceptance letters all carry `quote` and the
 * quotation's id, so one query answers "what has gone out about this".
 */
export async function emailsForEntity(
  env: Env, entityType: string, entityId: string,
): Promise<StoredEmail[]> {
  return all<StoredEmail>(
    env.DB,
    `SELECT ${COLUMNS} FROM outbound_emails e
       LEFT JOIN users u ON u.id = e.created_by
      WHERE e.entity_type = ? AND e.entity_id = ?
      ORDER BY e.created_at DESC`,
    entityType, entityId,
  );
}

/** The documents an email carried, by name, in the order they were attached. */
export async function attachmentsOf(
  env: Env, email: Pick<StoredEmail, 'attachment_ids'>,
): Promise<Array<{ id: string; filename: string }>> {
  const ids = (email.attachment_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return [];
  const rows = await allByIds<{ id: string; filename: string }>(
    env.DB, ids, (placeholders) => `SELECT id, filename FROM documents WHERE id IN (${placeholders})`);
  // The order the message was built in, not the database's. A document since
  // deleted simply drops out — the email still went with it, and the viewer
  // says how many names it could not find.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is { id: string; filename: string } => !!r);
}

/**
 * Where an email got to, in the practice's words rather than the column's.
 *
 * `queued` is not a failure and must not read like one: it means the provider
 * has not been reached yet and the letter is still going. `failed` carries the
 * provider's own message, because "it did not send" without the reason is a
 * sentence that helps nobody.
 */
export function sendState(e: Pick<StoredEmail, 'status' | 'sent_at' | 'error'>): {
  tone: 'green' | 'amber' | 'red' | 'grey';
  words: string;
} {
  switch (e.status) {
    case 'sent': return { tone: 'green', words: 'Sent' };
    case 'failed': return { tone: 'red', words: 'Did not send' };
    case 'cancelled': return { tone: 'grey', words: 'Cancelled before it went' };
    default: return { tone: 'amber', words: 'Waiting to send' };
  }
}

/**
 * The address of the list of everything sent about one record.
 *
 * Written here rather than in the module that serves it, so a record page can
 * link to a record's sent mail without importing another module's page.
 */
export function recordMailHref(entityType: string, entityId: string): string {
  return `/mail/for/${entityType}/${entityId}`;
}

export interface MailLink { href: string; label: string }

/**
 * The stored email a file note is talking about, if it can be told for certain.
 *
 * A note of an email sent carries the recipients and the subject in its body —
 * that is the summary `addEntry` has always written — so the note can be held
 * against the rows in `outbound_emails` for the same record and matched on both
 * of those. Two conditions rather than one: a practice that sends the same
 * quotation to a client and then to their agent has two notes differing only in
 * the address, and a subject-only match would send both to the same letter.
 *
 * **When it is not certain, it does not guess.** Several emails answering the
 * one note — the same letter sent twice to the same person, say — links to the
 * record's list instead, where every one of them is named with its date. A
 * wrong letter opened under the right heading is worse than one more click.
 */
export function mailLinkFor(
  entry: { kind: string; body: string },
  emails: StoredEmail[],
  listHref: string,
): MailLink | null {
  if (entry.kind !== 'email_out' || emails.length === 0) return null;

  const body = entry.body ?? '';
  const named = emails.filter((e) => {
    const recipients = (e.to_addr ?? '').split(',').map((a) => a.trim()).filter(Boolean);
    return e.subject.length > 0 && body.includes(e.subject)
      && recipients.length > 0 && recipients.every((a) => body.includes(a));
  });

  if (named.length === 1) return { href: `/mail/${named[0]!.id}`, label: 'Read the email as it was sent' };
  if (named.length > 1) return { href: listHref, label: 'Read the emails sent for this record' };
  // Nothing in the note matched, but this record has sent mail. One email and
  // one note is not ambiguous, whatever the note says — that is the case of a
  // note whose wording changed since, and it is the whole point of deriving
  // this at render time rather than writing a link into the note.
  if (emails.length === 1) return { href: `/mail/${emails[0]!.id}`, label: 'Read the email as it was sent' };
  return { href: listHref, label: 'Read the emails sent for this record' };
}
