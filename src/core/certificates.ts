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

/**
 * Where an issue date came from.
 *
 * The issue date is the load-bearing fact — the expiry, and therefore a legal
 * deadline, is worked out from it (0029). A date read off the certificate and
 * a date guessed from a document's filename must never look the same, so every
 * issue date states its source and the database refuses one that does not
 * (migration 0040). Anything not `verified` is flagged wherever the derived
 * expiry is shown.
 */
export type IssueDateProvenance = 'verified' | 'from_filename' | 'from_ocr' | 'unverified';

export const PROVENANCE_OPTIONS: Array<{ value: IssueDateProvenance; label: string }> = [
  { value: 'verified', label: 'Read from the certificate itself' },
  { value: 'from_filename', label: 'Taken from a document’s filename' },
  // The practice's decision of 31 August 2026: OCR may read a scanned
  // certificate, and what it reads is better evidence than a filename — but it
  // is a machine's reading, so it stays flagged until a person confirms it.
  { value: 'from_ocr', label: 'Read off the scan by OCR — not yet confirmed' },
  { value: 'unverified', label: 'Not confirmed — source unknown' },
];

/** True when a derived expiry rests on a date never confirmed against the paper. */
export function issueDateUnverified(row: Pick<CertificateRow, 'issued_on' | 'issued_on_provenance'>): boolean {
  return row.issued_on !== null && row.issued_on_provenance !== 'verified';
}

export interface CertificateRow {
  id: string;
  client_id: string;
  kind: CertificateKind;
  subtype: string | null;
  country: string | null;
  reference: string | null;
  issued_on: string | null;
  /** How the issue date was established. Never null when `issued_on` is set. */
  issued_on_provenance: IssueDateProvenance | null;
  /** The day it went in with an application, which is what extends it. */
  submitted_on: string | null;
  /** Worked out by the database for a police certificate or a medical. */
  expires_on: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * How long INZ treats a certificate as good for.
 *
 * Here for the wording on the page only. The dates themselves are worked out in
 * the database — see `migrations/0029_certificate_validity.sql` — because an
 * expiry typed by hand is wrong sooner or later, and wrong quietly. Two copies
 * of the arithmetic would be the same problem one level up, so this describes
 * the rule and never applies it.
 */
export const CERTIFICATE_VALIDITY: Record<CertificateKind, { held: number; submitted: number } | null> = {
  police: { held: 6, submitted: 24 },
  medical: { held: 3, submitted: 36 },
  // No rule stated for an x-ray, so its expiry stays hand-entered.
  chest_xray: null,
};

/** Why a certificate expires when it does, in words, for the page. */
export function validityRule(kind: CertificateKind): string | null {
  const rule = CERTIFICATE_VALIDITY[kind];
  if (!rule) return null;
  return `${rule.held} months from issue — ${rule.submitted} months once it has gone in `
    + 'with an application.';
}

/** Whether this kind's expiry is worked out rather than entered. */
export function expiryIsDerived(kind: CertificateKind): boolean {
  return CERTIFICATE_VALIDITY[kind] !== null;
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
    reference: string | null; issuedOn: string | null; issuedOnProvenance: IssueDateProvenance | null;
    submittedOn: string | null;
    expiresOn: string | null; notes: string | null; userId: string | null;
  },
): Promise<string> {
  const id = newId('crt');
  // `expires_on` is passed for an x-ray and left null for the other two: the
  // database fills those from the issue date. Writing a guess here would give
  // the column a second owner, and the trigger would overwrite it anyway.
  await run(
    env.DB,
    `INSERT INTO client_certificates (id, client_id, kind, subtype, country, reference,
        issued_on, issued_on_provenance, submitted_on, expires_on, notes, created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, input.clientId, input.kind, input.subtype, input.country, input.reference,
    input.issuedOn, input.issuedOn ? input.issuedOnProvenance : null, input.submittedOn,
    expiryIsDerived(input.kind) ? null : input.expiresOn,
    input.notes, nowIso(), input.userId,
  );
  await refreshClientCache(env, input.clientId);
  return id;
}

/**
 * Record — or clear — the day a certificate went in with an application.
 *
 * That is the whole edit: the expiry follows from it, and the database applies
 * the rule. Nothing here works out a date.
 */
export async function setCertificateSubmitted(
  env: Env, clientId: string, id: string, submittedOn: string | null,
): Promise<boolean> {
  const res = await run(
    env.DB,
    `UPDATE client_certificates SET submitted_on = ? WHERE id = ? AND client_id = ?`,
    submittedOn, id, clientId,
  );
  await refreshClientCache(env, clientId);
  return (res.meta?.changes ?? 0) > 0;
}

/**
 * Confirm — after the fact — that an issue date was read from the certificate.
 *
 * The way an unverified date stops being one: somebody holds the paper, checks
 * the date, and presses the button. Only the upgrade to `verified` is offered;
 * un-verifying would mean the paper stopped saying what it says.
 */
export async function confirmIssueDate(env: Env, clientId: string, id: string): Promise<boolean> {
  const res = await run(
    env.DB,
    `UPDATE client_certificates SET issued_on_provenance = 'verified'
      WHERE id = ? AND client_id = ? AND issued_on IS NOT NULL`,
    id, clientId,
  );
  return (res.meta?.changes ?? 0) > 0;
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
