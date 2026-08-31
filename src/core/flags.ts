/**
 * Warnings on a file.
 *
 * A flag is a short standing statement about a client or a matter, shown at the
 * top of the record so it is read before anything is said rather than found
 * afterwards. The practice asked for it on reading a partnership summary that
 * recorded an assault reported to Police — a fact that changes how a matter is
 * handled, with no column of its own, three screens down in a file note.
 *
 * Two rules shape everything here.
 *
 * **A flag on a person follows them onto their matters.** The fact is about the
 * person, not about one application, and having to raise it again on every new
 * matter is how it stops being raised.
 *
 * **A flag can be given a life.** Some are permanent; some are true for a
 * season. One past its date stops showing without anybody remembering to take
 * it down, and is not deleted — it is history, and it can be put back.
 *
 * A flag is not a file note. A note records what was said at the time and is
 * append-only; a flag is a live statement about now, reworded while it stands
 * and taken down when it stops applying.
 */

import type { Env } from '../types';
import { all, nowIso, run } from './db';
import { newId } from './ids';
import { FLAG_KIND_VOCAB, vocabulary, type Term } from './vocabulary';

export interface Flag {
  id: string;
  entity_type: 'client' | 'case';
  entity_id: string;
  kind: string;
  body: string;
  raised_at: string;
  raised_by: string | null;
  expires_on: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
  cleared_note: string | null;
  updated_at: string;
  raised_by_name?: string | null;
  /** Set when the flag is on the client and is being shown on their matter. */
  from_client?: boolean;
}

/**
 * How long a flag stands, offered as a choice rather than a date box.
 *
 * "Until I take it down" first and default, because that is what a warning
 * usually is. The rest are the seasons the practice actually named — a client
 * overseas, a refuge, a period of grace.
 */
export const FLAG_LIVES: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'standing', label: 'Until it is taken down', days: null },
  { value: '30', label: 'For 30 days', days: 30 },
  { value: '90', label: 'For 3 months', days: 90 },
  { value: '180', label: 'For 6 months', days: 180 },
  { value: '365', label: 'For a year', days: 365 },
];

export function expiryFor(life: string | null | undefined, from = new Date()): string | null {
  const chosen = FLAG_LIVES.find((l) => l.value === life);
  if (!chosen?.days) return null;
  const d = new Date(from.getTime() + chosen.days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function flagKinds(env: Env): Promise<Term[]> {
  return vocabulary(env, FLAG_KIND_VOCAB);
}

/** Whether this flag should be showing today. */
export function isShowing(flag: Pick<Flag, 'cleared_at' | 'expires_on'>, today = todayIso()): boolean {
  if (flag.cleared_at) return false;
  return !flag.expires_on || flag.expires_on >= today;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The warnings to show at the top of a client's page.
 *
 * Everything raised on them and still standing, newest first — a warning added
 * this morning is the one most likely to be the reason you are looking.
 */
export async function flagsForClient(env: Env, clientId: string): Promise<Flag[]> {
  return all<Flag>(
    env.DB,
    `SELECT f.*, u.name AS raised_by_name FROM flags f
       LEFT JOIN users u ON u.id = f.raised_by
      WHERE f.entity_type = 'client' AND f.entity_id = ?
      ORDER BY f.raised_at DESC`,
    clientId,
  );
}

/**
 * The warnings to show at the top of a matter.
 *
 * Its own, and the client's — because a fact about the person is a fact on
 * their matter, and a warning that has to be raised again on every new file is
 * a warning that stops being raised. The client's are marked as theirs, so it
 * is clear where to go to take one down.
 */
export async function flagsForCase(env: Env, caseId: string, clientId: string): Promise<Flag[]> {
  const [own, theirs] = await Promise.all([
    all<Flag>(env.DB,
      `SELECT f.*, u.name AS raised_by_name FROM flags f
         LEFT JOIN users u ON u.id = f.raised_by
        WHERE f.entity_type = 'case' AND f.entity_id = ?
        ORDER BY f.raised_at DESC`, caseId),
    all<Flag>(env.DB,
      `SELECT f.*, u.name AS raised_by_name FROM flags f
         LEFT JOIN users u ON u.id = f.raised_by
        WHERE f.entity_type = 'client' AND f.entity_id = ?
        ORDER BY f.raised_at DESC`, clientId),
  ]);
  return [...own, ...theirs.map((f) => ({ ...f, from_client: true }))];
}

export async function raiseFlag(
  env: Env,
  input: {
    entityType: 'client' | 'case'; entityId: string; kind: string; body: string;
    life: string | null; byUserId: string;
  },
): Promise<string> {
  const id = newId('flg');
  const at = nowIso();
  await run(
    env.DB,
    `INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, raised_by,
                        expires_on, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, input.entityType, input.entityId, input.kind, input.body.trim(), at, input.byUserId,
    expiryFor(input.life), at,
  );
  return id;
}

/**
 * Take a flag down.
 *
 * Cleared, not deleted. A warning that stood on a file for six months is part
 * of how that file was handled, and why it came down is the useful half.
 */
export async function clearFlag(
  env: Env,
  input: { id: string; note: string | null; byUserId: string },
): Promise<void> {
  const at = nowIso();
  await run(
    env.DB,
    `UPDATE flags SET cleared_at = ?, cleared_by = ?, cleared_note = ?, updated_at = ?
      WHERE id = ? AND cleared_at IS NULL`,
    at, input.byUserId, input.note?.trim() || null, at, input.id,
  );
}

/** Put a cleared or lapsed flag back, standing until it is taken down again. */
export async function raiseAgain(env: Env, id: string): Promise<void> {
  const at = nowIso();
  await run(
    env.DB,
    `UPDATE flags SET cleared_at = NULL, cleared_by = NULL, cleared_note = NULL,
                      expires_on = NULL, raised_at = ?, updated_at = ?
      WHERE id = ?`,
    at, at, id,
  );
}
