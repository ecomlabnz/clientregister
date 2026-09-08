/**
 * What a matter is called.
 *
 * A matter has a **name** and a **description**, and they are different things.
 * Migration 0026 separated them for that reason: the name says which matter
 * this is when it appears in a list of two hundred, and the description says
 * what makes it different from the next matter of the same kind for the same
 * person. "Partner Resident Visa — [retired example 1]" is the first;
 * "Meat Process Worker, Canterbury, South Pacific Meats" is the second.
 *
 * That separation was then quietly undone. The New matter form asked one
 * question — *what this matter is about* — and wrote the answer into both
 * columns, with a comment explaining that a title fed from the description
 * could not drift away from it. True, and the wrong trade: it meant every
 * matter in the register was named by an 84-character sentence, and every
 * list that showed the name and the description showed the same words twice,
 * with the client's name and the reference cut off the end for want of room.
 * Measured on 8 September 2026: 194 matters, 194 with `title = descriptor`,
 * 161 of them over sixty characters.
 *
 * So the name is derived again, and **this is the only place that composes
 * one**. Deriving it means it has inputs, and the inputs change: a matter's
 * type can be corrected, a client's name can be respelled. Everything that
 * changes an input calls `renameMattersFor` below, so a name cannot drift out
 * of step with the record it names — which is exactly how this went wrong the
 * first time.
 */

import type { Env } from '../types';
import { all, run } from './db';
import { labelFor, type Term } from './vocabulary';

/**
 * The name, from the type and the person it is for.
 *
 * Written the way the practice writes it. Both halves are wanted: the type
 * alone repeats across a client's matters, and the name alone repeats across a
 * client's file. An em dash rather than a hyphen, because migration 0026 split
 * the old titles on exactly that and the convention is theirs.
 */
export function caseName(typeLabel: string, clientName: string | null | undefined): string {
  const type = (typeLabel || '').trim();
  const who = (clientName || '').trim();
  if (type && who) return `${type} — ${who}`;
  // A matter with no client is not supposed to exist — `client_id` is NOT NULL
  // — but a name is NOT NULL too, and returning an empty string here would
  // trade a display problem for a refused write.
  return type || who || 'Matter';
}

/** The same, taking the raw type key and the vocabulary to read it with. */
export function caseNameFrom(
  types: Term[], caseType: string | null | undefined, clientName: string | null | undefined,
): string {
  return caseName(labelFor(types, caseType), clientName);
}

/**
 * Rewrite the names of every matter belonging to one client.
 *
 * Called when a client is renamed. Without it, correcting the spelling of
 * somebody's name would leave the old spelling on the front of every matter
 * they have — the drift this file exists to prevent, arriving by the back door.
 *
 * Deliberately not a database trigger, although the register's rule is that
 * invariants live in the database. This is not an invariant: it is a derived
 * label, and the derivation needs the case-type vocabulary, which is a settings
 * row holding "key | Label" lines. A trigger that parsed that blob on every
 * client update would be a great deal of SQL standing between the practice and
 * saving a name.
 *
 * Returns how many were renamed, so a caller can say so.
 */
export async function renameMattersFor(
  env: Env, clientId: string, clientName: string, types: Term[],
): Promise<number> {
  const rows = await all<{ id: string; case_type: string | null; title: string }>(
    env.DB, 'SELECT id, case_type, title FROM cases WHERE client_id = ?', clientId);
  let changed = 0;
  for (const row of rows) {
    const name = caseName(labelFor(types, row.case_type), clientName);
    if (name === row.title) continue;
    await run(env.DB, 'UPDATE cases SET title = ?, updated_at = ? WHERE id = ?',
      name, new Date().toISOString(), row.id);
    changed += 1;
  }
  return changed;
}
