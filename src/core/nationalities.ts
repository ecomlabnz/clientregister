/**
 * The nationalities a person holds.
 *
 * One person, one or more countries. That is not a nicety: dual nationality
 * decides whether somebody needs a visa at all, which police certificates are
 * required and which passport an application is made on, and a field that
 * cannot hold the answer is worse than no field. The register held one country
 * per client until 31 August 2026, so a partnership file naming a dual
 * Vietnamese and New Zealand partner recorded neither.
 *
 * One owner. Nothing outside this module writes `client_nationalities`, and
 * nothing anywhere assembles the list from a column — the column is gone. The
 * codes are ISO 3166-1 alpha-2 and the database enforces that with a trigger,
 * so a bad code is refused however it arrives.
 *
 * Order is kept, and it means something: the first is the nationality the
 * practice would name first — the passport the application is likely to be
 * made on. The rest are held, not ranked.
 */

import type { Env } from '../types';
import { countryCodeFor } from './countries';

/** At most this many on one person. Enough for anybody; a bound all the same. */
export const MAX_NATIONALITIES = 6;

/**
 * The form field names for one person's nationalities: `nationality`,
 * `nationality_2`, `nationality_3` … and always one more box than they hold,
 * so a third can be added by filling it in and saving.
 *
 * A growing set of boxes rather than an "add another" button, because the
 * content policy forbids an inline script and a control that stops working
 * when script is blocked is a field nobody can reach. One spare box costs a
 * line on the form and needs nothing.
 */
export function nationalityFieldNames(held: number, prefix = ''): string[] {
  const boxes = Math.min(MAX_NATIONALITIES, Math.max(2, held + 1));
  return Array.from({ length: boxes }, (_, i) =>
    `${prefix}nationality${i === 0 ? '' : `_${i + 1}`}`);
}

/**
 * The statements that make a person's nationalities exactly `codes`.
 *
 * Returned rather than run, so a caller can put them in the same `batch()` as
 * the row they belong to: a client saved with nationalities that did not save
 * is a worse outcome than either.
 */
export function setNationalityStatements(
  env: Env,
  clientId: string,
  codes: string[],
): D1PreparedStatement[] {
  const wanted = normaliseCodes(codes);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM client_nationalities WHERE client_id = ?').bind(clientId),
  ];
  wanted.forEach((code, position) => {
    statements.push(env.DB
      .prepare('INSERT INTO client_nationalities (client_id, code, position) VALUES (?, ?, ?)')
      .bind(clientId, code, position));
  });
  return statements;
}

/**
 * Codes from a form, cleaned: uppercased, de-duplicated, order kept, bounded.
 *
 * Two boxes offering the same country is an ordinary slip rather than an
 * error worth a page about, so the second is dropped and the first stands.
 */
export function normaliseCodes(codes: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const raw of codes) {
    const code = (raw ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) continue;
    if (out.includes(code)) continue;
    out.push(code);
    if (out.length >= MAX_NATIONALITIES) break;
  }
  return out;
}

/** What the model returned — "Vietnam and New Zealand", "Vietnamese", "SRV". */
export function codesFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  // A document writes two nationalities as one phrase far more often than as
  // two fields. Splitting on the words that join them is what turns "Vietnam
  // and New Zealand" into two codes instead of nothing.
  const parts = text.split(/\s*(?:,|;|\/|\band\b|\&|\+)\s*/i);
  return normaliseCodes(parts.map((part) => countryCodeFor(strip(part))));
}

/**
 * The words a document wraps a nationality in.
 *
 * "dual Vietnamese/New Zealand citizen" splits into "dual Vietnamese" and
 * "New Zealand citizen", and neither is the name of a country. Stripped here
 * rather than by teaching the country list every phrasing, because the list is
 * of countries and this is about English.
 */
function strip(part: string): string {
  return part
    .replace(/^\s*(?:a|an|the|dual|also|both|holds?|of)\b\s*/i, '')
    .replace(/\b(?:citizens?h?i?p?|nationals?|nationality|passports?|holders?)\s*$/i, '')
    .trim();
}

export async function nationalitiesFor(env: Env, clientId: string): Promise<string[]> {
  const rows = await env.DB
    .prepare('SELECT code FROM client_nationalities WHERE client_id = ? ORDER BY position, code')
    .bind(clientId).all<{ code: string }>();
  return (rows.results ?? []).map((r) => r.code);
}

/**
 * The nationalities of many people at once, for a list.
 *
 * A list of fifty clients must not become fifty queries. The ids are
 * interpolated as placeholders, never as values.
 */
export async function nationalitiesByClient(
  env: Env,
  clientIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (clientIds.length === 0) return out;
  const placeholders = clientIds.map(() => '?').join(',');
  const rows = await env.DB
    .prepare(`SELECT client_id, code FROM client_nationalities
               WHERE client_id IN (${placeholders}) ORDER BY position, code`)
    .bind(...clientIds).all<{ client_id: string; code: string }>();
  for (const row of rows.results ?? []) {
    out.set(row.client_id, [...(out.get(row.client_id) ?? []), row.code]);
  }
  return out;
}
