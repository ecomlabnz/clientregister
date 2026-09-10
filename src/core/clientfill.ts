/**
 * Putting what a document said into the boxes a client record has left empty.
 *
 * One rule, and it is the whole of this file: **what is there wins, always.**
 * `COALESCE(NULLIF(col, ''), ?)` says it in SQL, and saying it in SQL rather
 * than in an `if` is deliberate — the check and the write are then one
 * statement, so a value typed by a person between the moment a screen was drawn
 * and the moment somebody pressed the button is still not overwritten.
 *
 * A document is evidence of what somebody wrote on a form once. The record is
 * what the practice knows now. A reading that quietly replaced a corrected visa
 * expiry with an older one would be worse than a reading that filled nothing
 * in.
 *
 * This lived inside `modules/assistant/intake.ts` until 11 September 2026,
 * where it was reachable only while *creating* a client. It moved here whole
 * — not copied — when the practice asked for the same thing pointed at a
 * matter that already exists: *"give AI data, point to a case and ask it to
 * populate ll possible fields"*. Two copies of a merge rule are two merge
 * rules, free to disagree about which one is safe.
 */

import type { Env } from '../types';
import { nowIso, run } from './db';
import { nationalitiesFor, setNationalityStatements } from './nationalities';
import { isValidNzbnFormat, normaliseNzbn } from '../integrations/nzbn';

/**
 * An NZBN the register would accept, or nothing.
 *
 * A number read off a document can arrive spaced, hyphenated or simply wrong.
 * Stored as read, it is rejected the first time somebody opens the client and
 * saves — a worse place to find out than on the screen where the reading is
 * still visible beside it.
 */
export function normalisedNzbn(value: string | null): string | null {
  if (!value) return null;
  const clean = normaliseNzbn(value);
  return isValidNzbnFormat(clean) ? clean : null;
}

/**
 * The columns on `clients` a reading may fill, and what to call each on screen.
 *
 * Every one of them is a plain fact a document states about a person or a
 * company, owned by the client record itself and by nothing else. What is
 * absent matters more than what is here:
 *
 *  - **`full_name`, `given_names`, `family_name`** — identity. The client
 *    already exists and is already named; renaming somebody from a document is
 *    not "filling an empty box", and `cases.title` is composed from the name,
 *    so a second writer of it would leave every matter's name stale.
 *  - **`passport_number`, `passport_country`, `passport_expiry`** — the
 *    extraction deliberately never reads a passport number, and the other two
 *    are a cache of `client_passports` maintained elsewhere.
 *  - **`police_certificate_*`, `medical_certificate_*`, `chest_xray_expiry`** —
 *    a cache of `client_certificates` that **the database itself** keeps since
 *    migration 0082. A route writing them is the exact fault that migration
 *    exists to end.
 *  - **`status`, `assigned_to`** — workflow and ownership. A document does not
 *    decide who in the practice owns a client.
 *  - **`organisation_id`, `primary_contact_id`, `organisation_role`** — links
 *    between two records. Making one means deciding which other record is
 *    meant, and that decision belongs to a person on a screen that shows both.
 *  - **`notes`** — free text somebody wrote. Additions go to a file note, which
 *    is append-only and says where they came from.
 */
export const CLIENT_FILLABLE = [
  { column: 'preferred_name', label: 'Known as' },
  { column: 'email', label: 'Email' },
  { column: 'phone', label: 'Phone' },
  { column: 'address', label: 'Address' },
  { column: 'date_of_birth', label: 'Date of birth' },
  { column: 'current_visa_type', label: 'Current visa' },
  { column: 'current_visa_expiry', label: 'Current visa expiry' },
  { column: 'nzbn', label: 'NZBN' },
] as const;

export type ClientFillColumn = (typeof CLIENT_FILLABLE)[number]['column'];

/** What a reading offers for one client, column by column. Nulls are ignored. */
export type ClientFillValues = Partial<Record<ClientFillColumn, string | null>>;

/**
 * Fill the empty ones. Returns the columns actually offered to the database.
 *
 * "Offered" and not "written": whether a column changed is the database's
 * answer, not this function's, because the statement itself is the guard. A
 * caller that needs to report what changed reads the row before and after.
 */
export async function fillEmptyClientFields(
  env: Env, clientId: string, values: ClientFillValues,
): Promise<ClientFillColumn[]> {
  const offered = CLIENT_FILLABLE
    .map(({ column }) => [column, values[column] ?? null] as const)
    .filter(([, value]) => value !== null && value !== '');
  if (offered.length === 0) return [];
  await run(
    env.DB,
    `UPDATE clients SET ${offered.map(([column]) =>
        `${column} = COALESCE(NULLIF(${column}, ''), ?)`).join(', ')}, updated_at = ?
      WHERE id = ?`,
    ...offered.map(([, value]) => value), nowIso(), clientId,
  );
  return offered.map(([column]) => column);
}

/**
 * Record nationalities, but only for a client who has none.
 *
 * All-or-nothing rather than merged: a person who holds two and is recorded as
 * holding one is recorded *wrongly*, and merging a list has no obvious right
 * answer. So the rule is the narrow one — a record that says nothing about
 * nationality can be told; a record that says something is left alone.
 *
 * Returns what was written, or an empty list when the client already held any.
 */
export async function fillEmptyNationalities(
  env: Env, clientId: string, proposed: string[],
): Promise<string[]> {
  if (proposed.length === 0) return [];
  const held = await nationalitiesFor(env, clientId);
  if (held.length > 0) return [];
  await env.DB.batch(setNationalityStatements(env, clientId, proposed));
  return proposed;
}

/**
 * Put an INZ client number on a client, if it is safe to.
 *
 * Never over what is recorded, and never one another client holds — the column
 * is unique, so a clash would abort the statement and lose the whole press. A
 * number that cannot be written is not an error: the client page shows the gap
 * and the alerts page lists it.
 *
 * Both conditions live in the `WHERE`, for the same reason the merge above
 * does: checked and written in one statement, or not checked at all.
 */
export async function setInzClientNumber(
  env: Env, clientId: string, typed: string | null,
): Promise<boolean> {
  const number = (typed ?? '').replace(/[\s-]/g, '');
  if (!/^[0-9]{6,12}$/.test(number)) return false;
  const result = await run(
    env.DB,
    `UPDATE clients SET inz_client_number = ?, updated_at = ?
      WHERE id = ? AND COALESCE(TRIM(inz_client_number), '') = ''
        AND NOT EXISTS (SELECT 1 FROM clients o WHERE o.inz_client_number = ? AND o.id <> ?)`,
    number, nowIso(), clientId, number, clientId,
  );
  return (result.meta?.changes ?? 0) > 0;
}
