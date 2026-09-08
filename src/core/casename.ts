/**
 * What a matter is called.
 *
 * A matter has a **name** and a **description**, and they are different things.
 * Migration 0026 separated them for that reason: the name says which matter
 * this is when it appears in a list of two hundred, and the description says
 * what makes it different from the next matter of the same kind for the same
 * person. "Partner Resident Visa — Dinh Dai Phu PHAN" is the first;
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
import { all, one, run } from './db';
import { labelFor, type Term } from './vocabulary';

/**
 * The name, from the type and the person it is for.
 *
 * Written the way the practice writes it. Both halves are wanted: the type
 * alone repeats across a client's matters, and the name alone repeats across a
 * client's file. An em dash rather than a hyphen, because migration 0026 split
 * the old titles on exactly that and the convention is theirs.
 *
 * **The type comes first, and that is load-bearing.** The practice, on seeing
 * it: *"I like the case naming where the visa type precedes the name — it
 * allows me to sort the cases by visa type, very helpful."* Sorting by name is
 * therefore grouping by kind of work, on every list in the register, with no
 * second column and no separate control. Anybody tempted to put the person
 * first is taking that away.
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

/**
 * What a quotation is called.
 *
 * The same convention, for the same reason. The New quote form asked for a
 * free-text "Scope", and the practice, on looking at it: *"this field called
 * Scope seems superfluous. why do i need to enter details in it when that will
 * be in the quotation?"* Half right, and worth separating the halves.
 *
 * The *paragraph* it printed on the quotation was superfluous — the items are
 * the scope, and a sentence beside them can only repeat them or disagree with
 * them. That section is gone.
 *
 * The value itself is not: it is the quotation's **name**, and it appears in
 * the quotes list, the quote's own heading, the dashboard, search, the expiry
 * alert, the email subject, the invoice raised from it and the bulk export.
 * Delete it and all eight become a column of Q-numbers. So it stays, and stops
 * being typed: the practice was writing the visa type by hand into it, which is
 * exactly what this file exists to stop.
 *
 * `extra` is the quotation's equivalent of a matter's descriptor — the words
 * that tell two quotations of the same kind for the same person apart. It sits
 * with the type rather than after the name, because the type and the extra
 * words together are what the work *is*, and sorting by name must still group
 * by kind of work.
 */
export function quoteName(
  typeLabel: string, extra: string | null | undefined, clientName: string | null | undefined,
): string {
  const type = [(typeLabel || '').trim(), (extra || '').trim()].filter(Boolean).join(' ');
  return caseName(type, clientName);
}

/** The same, taking the raw type key and the vocabulary to read it with. */
export function quoteNameFrom(
  types: Term[], caseType: string | null | undefined,
  extra: string | null | undefined, clientName: string | null | undefined,
): string {
  return quoteName(labelFor(types, caseType), extra, clientName);
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

/**
 * Put an existing client's name into the house style, and its matters with it.
 *
 * Reported by the practice on 8 September 2026: a matter opened through the
 * assistant arrived with the surname not in capitals, and they corrected it by
 * hand. The assistant had not failed to capitalise anything — it had reused an
 * existing client record, faithfully, and that record had been loaded on
 * 1 September before the rule reached it.
 *
 * Migration 0070 corrected all 34 such records, so the specific fault is gone.
 * The hole it came through is not: **the register never tidies a record it
 * merely reuses.** Another bulk load, an import, a row written by hand, and the
 * same thing happens again — and the matter named from that record carries the
 * old spelling into every list.
 *
 * So it is done at the point where the register is already writing. This is a
 * house-style correction and not a change of fact: `LE` and `Le` are the same
 * surname, which is exactly why it is safe to do without asking, and why it is
 * kept apart from `fillEmptyFields`, which deliberately never writes over
 * anything a person recorded.
 *
 * Returns what it did, so a caller can put it on the file. Null when there was
 * nothing to do — which is the ordinary case.
 */
export async function normaliseClientName(
  env: Env, clientId: string, types: Term[],
): Promise<{ was: string; now: string; matters: number } | null> {
  const client = await one<{
    id: string; kind: string; full_name: string;
    given_names: string | null; family_name: string | null;
  }>(env.DB, 'SELECT id, kind, full_name, given_names, family_name FROM clients WHERE id = ?', clientId);
  // A company's registered name is copied from the register that holds it and
  // is not the practice's to restyle.
  if (!client || client.kind !== 'individual') return null;
  const family = (client.family_name ?? '').trim();
  if (!family || family === family.toUpperCase()) return null;

  const capitals = family.toUpperCase();
  const fullName = [(client.given_names ?? '').trim(), capitals].filter(Boolean).join(' ');
  await run(
    env.DB,
    'UPDATE clients SET family_name = ?, full_name = ?, updated_at = ? WHERE id = ?',
    capitals, fullName, new Date().toISOString(), clientId,
  );
  // A matter is named after the person, so the correction has to reach them or
  // the old spelling stays on the front of every one.
  const matters = await renameMattersFor(env, clientId, fullName, types);
  return { was: client.full_name, now: fullName, matters };
}
