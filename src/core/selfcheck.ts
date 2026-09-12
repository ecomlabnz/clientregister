/**
 * The self-check: the register reading its own data against its own lists.
 *
 * **Asked for on 12 September 2026**, after 35 client records were found
 * holding the *label* of a visa instead of its key: *"A self-check page — the
 * register reading its own data against its own lists and reporting anything
 * that doesn't match. That's your import dry-run: load, look at the report,
 * fix, before anyone relies on it."*
 *
 * The rule lives in the database, in `vocabulary_mismatches` (migration 0101),
 * and not here. That is deliberate and it is the whole design: the same view
 * that decides what counts as a mismatch is the one the guard triggers use, so
 * the report and the refusal cannot disagree. This file reads it and gives the
 * columns names a person recognises.
 *
 * **It reports and never fixes.** There is no write path in this file, and the
 * thing it reads is a view, so there is nothing to write through. Correcting a
 * value is a decision about a client's file — `Work Visa - Accredited Employer
 * Work Visa` is *probably* `wv_aewv`, and probably is not good enough — so it
 * stays with whoever is loading the data.
 */

import { all } from './db';
import { VOCABULARIES } from './vocabulary';
import type { Env } from '../types';

export interface Mismatch {
  table_name: string;
  column_name: string;
  setting_key: string;
  value: string;
  rows_affected: number;
  /** A few of the records carrying it, for somebody going to look. */
  example_ids: string | null;
}

/**
 * What each guarded column is, in the words somebody reading the page uses.
 *
 * A column the database guards and this map has no name for still shows, under
 * `table.column` — a report that hid a problem because nobody had written a
 * label for it would be the worst possible failure of this page.
 */
export const COLUMN_NAMES: Record<string, string> = {
  'clients.current_visa_type': 'The visa a client holds now',
  'clients.english_test_type': 'A client’s English test or exemption',
  'clients.title': 'How a client is addressed',
  'clients.gender': 'A client’s gender',
  'clients.relationship_status': 'A client’s relationship status',
  'cases.case_type': 'What kind of matter it is',
  'quotes.case_type': 'What kind of matter a quotation is for',
  'quote_items.case_type': 'What kind of matter a line of a quotation is for',
  'documents.category': 'The heading a file is kept under',
  'flags.kind': 'What kind of warning it is',
  'entries.kind': 'What kind of file note it is',
  'client_employment.kind': 'What a period of work history was',
  'client_education.level': 'How far a qualification went',
  'client_education.completed': 'Whether a course was finished',
  'client_travel.purpose': 'Why a trip was made',
  'client_travel.mode': 'How a trip was made',
};

export function columnName(m: Pick<Mismatch, 'table_name' | 'column_name'>): string {
  return COLUMN_NAMES[`${m.table_name}.${m.column_name}`] ?? `${m.table_name}.${m.column_name}`;
}

/** The label of the list a value should have come from. */
export function listName(settingKey: string): string {
  return VOCABULARIES.find((v) => v.key === settingKey)?.label ?? settingKey;
}

/** Every stored value that is not on its list, worst first. */
export async function vocabularyMismatches(env: Env): Promise<Mismatch[]> {
  return all<Mismatch>(
    env.DB,
    `SELECT table_name, column_name, setting_key, value, rows_affected, example_ids
       FROM vocabulary_mismatches
      ORDER BY rows_affected DESC, table_name, column_name, value`,
  );
}

/**
 * How many terms the database holds for each list.
 *
 * On the page because a list showing **no** terms is the one state in which the
 * guard stands aside entirely — see migration 0101, rule 3 — and somebody
 * reading a clean report deserves to know whether it is clean because the data
 * is right or because nothing was checked.
 */
export async function vocabularyListSizes(env: Env): Promise<Array<{ setting_key: string; terms: number }>> {
  const rows = await all<{ setting_key: string; terms: number }>(
    env.DB,
    `SELECT setting_key, COUNT(*) AS terms FROM vocabulary_terms GROUP BY setting_key`,
  );
  const known = new Map(rows.map((r) => [r.setting_key, r.terms]));
  return VOCABULARIES.map((v) => ({ setting_key: v.key, terms: known.get(v.key) ?? 0 }));
}

/** The first few records carrying a value, for somebody going to look. */
export function examples(m: Mismatch, howMany = 3): string[] {
  return (m.example_ids ?? '').split(',').filter(Boolean).slice(0, howMany);
}
