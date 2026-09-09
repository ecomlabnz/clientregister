/**
 * The private link a client opens, and the acceptance that comes back.
 *
 * **Asked for on 9 September 2026**, after the practice sent a test quote and
 * got a wall of plain text: *"the quote is not acceptable. no link, no nice
 * formatted page, no ACCEPT button, no letter of engagement — where is the rest
 * of the mechanics of it all??"* Nowhere. The email was the whole of it.
 *
 * ## The link
 *
 * 32 hexadecimal characters from `crypto.getRandomValues` — 128 bits, the same
 * standard the session cookie is held to. There is no account behind it and no
 * password: the address *is* the credential, which is why its length is a rule
 * the database keeps (migration 0078) rather than a habit of this file.
 *
 * A quotation is given its link the first time one is asked for and keeps it
 * for good. A link that changed would break an email already sent, and the
 * practice would have no way of knowing which client was holding a dead
 * address.
 *
 * ## The acceptance
 *
 * The client types their full name and the date, and ticks to say they have
 * read the documents. What is recorded is that, plus the moment the register
 * received it and where from — because the typed date is the client's word and
 * the received moment is the register's, and a document that recorded only one
 * of them would be less use in the one argument it exists for. They are stored
 * side by side and neither is corrected against the other.
 *
 * It is written once and never again, by anybody. See migration 0078.
 */

import type { Env } from '../types';
import { one, run } from './db';

/** 128 bits, hex, matching the shape the database insists on. */
export function newShareToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The quotation's link, minted on first use.
 *
 * Idempotent on purpose: the email route, the quotation page and anywhere else
 * that wants to show the address all call this, and they must all get the same
 * one. The insert is guarded by a unique index, so two requests arriving
 * together cannot produce two links — one of them loses and re-reads.
 */
export async function shareTokenFor(env: Env, quoteId: string): Promise<string | null> {
  const row = await one<{ share_token: string | null }>(
    env.DB, 'SELECT share_token FROM quotes WHERE id = ?', quoteId);
  if (!row) return null;
  if (row.share_token) return row.share_token;

  const token = newShareToken();
  await run(
    env.DB,
    'UPDATE quotes SET share_token = ? WHERE id = ? AND share_token IS NULL',
    token, quoteId);
  const after = await one<{ share_token: string | null }>(
    env.DB, 'SELECT share_token FROM quotes WHERE id = ?', quoteId);
  return after?.share_token ?? null;
}

/** The full address to put in an email. */
export function shareUrl(base: string, token: string): string {
  return `${base.replace(/\/+$/, '')}/q/${token}`;
}

export interface SharedQuote {
  id: string;
  ref: string;
  status: string;
  with_letter: number | null;
  valid_until: string | null;
  accepted_at: string | null;
  accepted_name: string | null;
  client_name: string | null;
}

/**
 * The quotation behind a link, or nothing.
 *
 * A token that is not ours and a token that is ours but malformed are the same
 * answer, and so is a quotation that has been withdrawn: a link that behaved
 * differently for a real reference than for an invented one would let somebody
 * learn which references exist by trying.
 */
export async function quoteByToken(env: Env, token: string): Promise<SharedQuote | null> {
  if (!/^[0-9a-f]{32,}$/.test(token)) return null;
  return one<SharedQuote>(
    env.DB,
    `SELECT q.id, q.ref, q.status, q.with_letter, q.valid_until, q.accepted_at,
            q.accepted_name, cl.full_name AS client_name
       FROM quotes q
       LEFT JOIN clients cl ON cl.id = q.client_id
      WHERE q.share_token = ?`,
    token,
  );
}

/** Why a client cannot accept right now, in words they can act on. */
export function whyNotAcceptable(q: SharedQuote, today: string): string | null {
  if (q.accepted_at) return 'already-accepted';
  if (q.status === 'withdrawn' || q.status === 'declined') {
    return 'This quotation has been withdrawn. Please contact us if you would like a new one.';
  }
  if (q.status === 'accepted') return 'already-accepted';
  if (q.status !== 'sent') {
    return 'This quotation is not open for acceptance. Please contact us.';
  }
  if (q.valid_until && q.valid_until < today) {
    return 'This quotation has expired. Please contact us for a current one — the figures may have changed.';
  }
  return null;
}

export type AcceptResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Record an acceptance.
 *
 * The database is the authority on whether this is allowed — the checks above
 * exist to say something useful to somebody standing in front of the form, not
 * to decide. If the two ever disagree, the database wins and the client is told
 * plainly rather than shown a stack trace.
 */
export async function acceptQuote(
  env: Env,
  quoteId: string,
  typed: { name: string; signedOn: string; from: string },
  at: string,
): Promise<AcceptResult> {
  const name = typed.name.trim().slice(0, 200);
  if (!name) return { ok: false, message: 'Please type your full name.' };

  try {
    await run(
      env.DB,
      `UPDATE quotes
          SET accepted_at = ?, accepted_name = ?, accepted_from = ?,
              status = 'accepted', responded_at = ?, updated_at = ?
        WHERE id = ? AND accepted_at IS NULL`,
      at, name, `${typed.from} · signed ${typed.signedOn}`.slice(0, 200), at, at, quoteId);
  } catch {
    // The refusals are written for the practice, not for a client — see
    // migration 0078. A client gets the one sentence that is true whichever of
    // them fired: it is no longer theirs to accept.
    return {
      ok: false,
      message: 'This quotation can no longer be accepted online. Please contact us.',
    };
  }
  return { ok: true };
}
