/**
 * Passports.
 *
 * A person may hold more than one, and the second is not a lesser copy of the
 * first. A dual national holds two at once. Someone who has just renewed holds
 * the new one and the old one carrying a live visa — which is why "Transfer to
 * New Passport" exists as a case type. So each passport is a record with its
 * own country, dates and number, and one of them is marked primary: the travel
 * document this file works from.
 *
 * The columns on `clients` are kept as a cache of the primary, because the
 * alerts page, the client list, the CSV export and the intake extraction all
 * read them and none of them should have to learn about this table. They are
 * refreshed from here on every change: this table is the record, those columns
 * are a convenience. Certificates work the same way, deliberately.
 *
 * The number is stored as written (the practice's decision, 30 August 2026 —
 * migration 0042). It shows on the client's page like the dates beside it.
 * The one deliberate hold-back: numbers stay out of the bulk CSV exports.
 */

import type { Env } from '../types';
import { all, nowIso, one, run } from './db';
import { newId } from './ids';

export type PassportStatus = 'held' | 'replaced' | 'lost' | 'cancelled';

export const PASSPORT_STATUSES: { value: PassportStatus; label: string }[] = [
  { value: 'held', label: 'Held' },
  { value: 'replaced', label: 'Replaced by a newer one' },
  { value: 'lost', label: 'Lost or stolen' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function passportStatusLabel(value: string): string {
  return PASSPORT_STATUSES.find((s) => s.value === value)?.label ?? value;
}

export interface PassportRow {
  id: string;
  client_id: string;
  country: string | null;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  status: PassportStatus;
  is_primary: number;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

/** Primary first, then the ones still held, then by expiry. */
export async function passportsFor(env: Env, clientId: string): Promise<PassportRow[]> {
  return all<PassportRow>(
    env.DB,
    `SELECT * FROM client_passports
      WHERE client_id = ?
      ORDER BY is_primary DESC,
               CASE status WHEN 'held' THEN 0 ELSE 1 END,
               COALESCE(expires_on, issued_on, created_at) DESC`,
    clientId,
  );
}

export async function passportById(
  env: Env, clientId: string, id: string,
): Promise<PassportRow | null> {
  return one<PassportRow>(
    env.DB, `SELECT * FROM client_passports WHERE id = ? AND client_id = ?`, id, clientId);
}

export interface PassportInput {
  clientId: string;
  country: string | null;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  status: PassportStatus;
  isPrimary: boolean;
  notes: string | null;
  userId: string | null;
}

export async function addPassport(env: Env, input: PassportInput): Promise<string> {
  const id = newId('pas');

  // The database allows one primary per client, so the old one is stood down
  // first. Doing it in that order means a failure leaves a client with no
  // primary rather than with two, and no primary is a state the rest of the
  // code already handles — it is what a client with no passport looks like.
  if (input.isPrimary) await clearPrimary(env, input.clientId);

  await run(
    env.DB,
    `INSERT INTO client_passports
       (id, client_id, country, number, issued_on, expires_on, status, is_primary,
        notes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.clientId, input.country, input.number, input.issuedOn, input.expiresOn,
    input.status, input.isPrimary ? 1 : 0, input.notes, nowIso(), input.userId,
  );
  await refreshClientPassportCache(env, input.clientId);
  return id;
}

/**
 * Change one.
 *
 * A blank number means "leave the stored one alone": on the client form the
 * box arrives empty, so an empty box is an absence of instruction rather than
 * an instruction to erase. Erasing is `clearNumber`, asked for separately.
 */
export async function updatePassport(
  env: Env,
  id: string,
  input: PassportInput & { clearNumber: boolean },
): Promise<void> {
  const existing = await passportById(env, input.clientId, id);
  if (!existing) return;

  const number = input.clearNumber
    ? null
    : input.number ?? existing.number;

  if (input.isPrimary && !existing.is_primary) await clearPrimary(env, input.clientId);

  await run(
    env.DB,
    `UPDATE client_passports SET country=?, number=?, issued_on=?, expires_on=?,
       status=?, is_primary=?, notes=?
     WHERE id=? AND client_id=?`,
    input.country, number, input.issuedOn, input.expiresOn, input.status,
    input.isPrimary ? 1 : 0, input.notes, id, input.clientId,
  );
  await refreshClientPassportCache(env, input.clientId);
}

export async function removePassport(env: Env, clientId: string, id: string): Promise<boolean> {
  const res = await run(
    env.DB, `DELETE FROM client_passports WHERE id = ? AND client_id = ?`, id, clientId);
  await refreshClientPassportCache(env, clientId);
  return (res.meta?.changes ?? 0) > 0;
}

/** Make one the travel document this file works from. */
export async function setPrimaryPassport(
  env: Env, clientId: string, id: string,
): Promise<boolean> {
  const target = await passportById(env, clientId, id);
  if (!target) return false;
  await clearPrimary(env, clientId);
  await run(
    env.DB, `UPDATE client_passports SET is_primary = 1 WHERE id = ? AND client_id = ?`,
    id, clientId);
  await refreshClientPassportCache(env, clientId);
  return true;
}

async function clearPrimary(env: Env, clientId: string): Promise<void> {
  await run(
    env.DB, `UPDATE client_passports SET is_primary = 0 WHERE client_id = ? AND is_primary = 1`,
    clientId);
}

/**
 * Push the primary passport back onto the client row.
 *
 * If nothing is marked primary — the client has passports but none chosen, or
 * has none at all — the columns are cleared rather than left showing a passport
 * that is no longer the answer. A stale cache here would put the wrong expiry
 * on the alerts page, which is worse than an empty one.
 */
export async function refreshClientPassportCache(env: Env, clientId: string): Promise<void> {
  const primary = await one<PassportRow>(
    env.DB,
    `SELECT * FROM client_passports WHERE client_id = ? AND is_primary = 1`,
    clientId,
  );
  await run(
    env.DB,
    `UPDATE clients SET passport_number = ?, passport_country = ?, passport_expiry = ?, updated_at = ?
      WHERE id = ?`,
    primary?.number ?? null, primary?.country ?? null, primary?.expires_on ?? null,
    nowIso(), clientId,
  );
}
