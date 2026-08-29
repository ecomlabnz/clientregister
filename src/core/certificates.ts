/**
 * Police certificates, medicals and x-rays.
 *
 * Each one is a record with its own dates rather than a field that the next one
 * overwrites. That distinction is the whole point: a matter lodged in March
 * relied on the certificate held in March, and a practice has to be able to say
 * which one that was — sometimes years later, sometimes to somebody asking
 * pointedly.
 *
 * The columns on `clients` are kept as a cache of the current certificate of
 * each kind, because the alerts page, the client list and the intake extraction
 * all read them and none of them should have to learn about this table. They
 * are refreshed from here on every change: this table is the record, those
 * columns are a convenience.
 */

import type { Env } from '../types';
import { all, nowIso, one, run } from './db';
import { newId } from './ids';

export type CertificateKind = 'police' | 'medical' | 'chest_xray';

export const CERTIFICATE_KINDS: CertificateKind[] = ['police', 'medical', 'chest_xray'];

export const CERTIFICATE_LABELS: Record<CertificateKind, string> = {
  police: 'Police certificate',
  medical: 'Medical certificate',
  chest_xray: 'Chest x-ray',
};

/** A medical is one or the other, and which decides what INZ accepts it for. */
export const MEDICAL_TYPES = [
  { value: 'general', label: 'General Medical (INZ 1007)' },
  { value: 'limited', label: 'Limited Medical (INZ 1201)' },
];

export function medicalTypeLabel(value: string | null): string {
  return MEDICAL_TYPES.find((t) => t.value === value)?.label ?? (value ?? '—');
}

export interface CertificateRow {
  id: string;
  client_id: string;
  kind: CertificateKind;
  subtype: string | null;
  country: string | null;
  reference: string | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export async function certificatesFor(env: Env, clientId: string): Promise<CertificateRow[]> {
  return all<CertificateRow>(
    env.DB,
    `SELECT * FROM client_certificates WHERE client_id = ?
      ORDER BY kind, COALESCE(issued_on, expires_on, created_at) DESC`,
    clientId,
  );
}

/**
 * The one that counts, per kind.
 *
 * The latest by issue date, falling back to expiry for a record where only the
 * expiry was ever known. A police certificate is per country, so the "current"
 * one is per country too — a client who has lived in three places holds three
 * at once, and none of them supersedes the others.
 */
export function currentOf(rows: CertificateRow[], kind: CertificateKind): CertificateRow[] {
  const mine = rows.filter((r) => r.kind === kind);
  if (kind !== 'police') return mine.slice(0, 1);

  const byCountry = new Map<string, CertificateRow>();
  for (const row of mine) {
    const key = (row.country ?? '').toLowerCase();
    const held = byCountry.get(key);
    if (!held || sortKey(row) > sortKey(held)) byCountry.set(key, row);
  }
  return [...byCountry.values()];
}

function sortKey(row: CertificateRow): string {
  return row.issued_on ?? row.expires_on ?? row.created_at;
}

export async function addCertificate(
  env: Env,
  input: {
    clientId: string; kind: CertificateKind; subtype: string | null; country: string | null;
    reference: string | null; issuedOn: string | null; expiresOn: string | null;
    notes: string | null; userId: string | null;
  },
): Promise<string> {
  const id = newId('crt');
  await run(
    env.DB,
    `INSERT INTO client_certificates (id, client_id, kind, subtype, country, reference,
        issued_on, expires_on, notes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.clientId, input.kind, input.subtype, input.country, input.reference,
    input.issuedOn, input.expiresOn, input.notes, nowIso(), input.userId,
  );
  await refreshClientCache(env, input.clientId);
  return id;
}

export async function removeCertificate(env: Env, clientId: string, id: string): Promise<boolean> {
  const res = await run(
    env.DB, `DELETE FROM client_certificates WHERE id = ? AND client_id = ?`, id, clientId);
  await refreshClientCache(env, clientId);
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Push the current certificate of each kind back onto the client row.
 *
 * Everything that watches expiry dates — the alerts page, the client list, the
 * automation triggers — reads those columns. Rather than teach each of them
 * about this table, the answer is written where they already look.
 *
 * The police certificate is the awkward one: several may be current at once, so
 * the column holds the *soonest* expiry, which is the one that will bite first
 * and therefore the one an alert should be about.
 */
export async function refreshClientCache(env: Env, clientId: string): Promise<void> {
  const rows = await certificatesFor(env, clientId);

  const police = currentOf(rows, 'police');
  const soonest = police
    .filter((p) => p.expires_on)
    .sort((a, b) => (a.expires_on ?? '').localeCompare(b.expires_on ?? ''))[0] ?? police[0] ?? null;
  const medical = currentOf(rows, 'medical')[0] ?? null;
  const xray = currentOf(rows, 'chest_xray')[0] ?? null;

  await run(
    env.DB,
    `UPDATE clients SET
       police_certificate_country = ?, police_certificate_date = ?, police_certificate_expiry = ?,
       medical_certificate_date = ?, medical_certificate_expiry = ?, medical_certificate_type = ?,
       chest_xray_expiry = ?, updated_at = ?
     WHERE id = ?`,
    soonest?.country ?? null, soonest?.issued_on ?? null, soonest?.expires_on ?? null,
    medical?.issued_on ?? null, medical?.expires_on ?? null, medical?.subtype ?? null,
    xray?.expires_on ?? null, nowIso(), clientId,
  );
}
