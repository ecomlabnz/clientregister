/**
 * Employment, education and travel: what a person has done, one period a row.
 *
 * **Asked for on 11 September 2026:** *"build placeholders for the histories
 * discussed - employment, education, international travel ... they will live
 * under a client, be formatted in a fashion that is similar to existing
 * pattern ... each also starts collapsed, they are not mandatory, but can be
 * filled by the AI ... Critical - periods of unemployment must also be able to
 * be entered into the Employment history with appropriate notes. IF AI is
 * filling it in - it must leave blank space if there is a gap, the user must be
 * able to move the table rows up or down - if possible, and add or delete more
 * lines for the entries."*
 *
 * The three tables are migration 0089, and the reasoning for their shape is
 * there rather than repeated here.
 *
 * ## Why one file rather than three
 *
 * The three tables disagree about what a row *holds* — that is exactly why they
 * are three tables — but they agree completely about what a person *does* with
 * one: list it, add a line, edit every line at once, reorder by typing a
 * number, tick a line out. Written three times that is three copies of the same
 * batch-save loop, and the third copy is the one that quietly stops matching.
 *
 * So the shape of each history is a `HistoryDef` — a list of columns — and
 * everything else here reads it. Adding residence history later (planned in
 * `docs/pipeline.md`, not asked for) is a table, a definition and nothing else.
 *
 * ## The batch save
 *
 * One form for the whole table, saved in one press: the same pattern quotation
 * lines and payment stages already use, which is what *"move the table rows up
 * or down"* means in a register that may not use script. Nothing happens until
 * Save, so several rows can be reordered and one crossed out in the same go,
 * and a slip can be untitled before it takes effect.
 */

import type { Env } from '../types';
import { all, nowIso, run } from './db';
import { newId } from './ids';
import type { FormReader } from './validate';

export type HistoryKey = 'employment' | 'education' | 'travel';

/** How one column of a history behaves, on the page and on the way in. */
export interface HistoryColumn {
  /** The database column, and the form field name before the row id. */
  name: string;
  label: string;
  kind: 'text' | 'date' | 'country' | 'vocab';
  /** For `kind: 'vocab'`, which vocabulary supplies the options. */
  vocab?: 'employment_kinds' | 'education_levels' | 'education_outcomes'
    | 'travel_purposes' | 'travel_modes';
  max?: number;
  /** Width of the input, in characters. Dates and selects size themselves. */
  size?: number;
}

export interface HistoryDef {
  key: HistoryKey;
  table: string;
  /** The heading on the client page. */
  title: string;
  /** What one row is, for "Add a …" and for a confirmation. */
  noun: string;
  columns: HistoryColumn[];
  /**
   * Whether to draw the space between two rows that do not meet.
   *
   * True for employment only. A gap in a work history is a question INZ asks;
   * a gap between two trips is just the rest of somebody's life.
   */
  showsGaps: boolean;
}

/**
 * The one column every history has, kept out of `columns` because it is drawn
 * differently — full width, under the row rather than beside it.
 */
export const HISTORY_NOTE_MAX = 1000;

export const EMPLOYMENT_HISTORY: HistoryDef = {
  key: 'employment',
  table: 'client_employment',
  title: 'Employment history',
  noun: 'period',
  showsGaps: true,
  columns: [
    // First, because it is what makes a period of unemployment recordable at
    // all — the practice called that out as critical — and because it decides
    // whether an employer is expected on the row.
    { name: 'kind', label: 'What', kind: 'vocab', vocab: 'employment_kinds' },
    { name: 'employer', label: 'Employer', kind: 'text', max: 200, size: 22 },
    { name: 'role', label: 'Role', kind: 'text', max: 200, size: 18 },
    { name: 'country', label: 'Country', kind: 'country' },
    { name: 'started_on', label: 'From', kind: 'date' },
    { name: 'ended_on', label: 'To', kind: 'date' },
  ],
};

export const EDUCATION_HISTORY: HistoryDef = {
  key: 'education',
  table: 'client_education',
  title: 'Education history',
  noun: 'course',
  showsGaps: false,
  columns: [
    { name: 'institution', label: 'Institution', kind: 'text', max: 200, size: 22 },
    { name: 'qualification', label: 'Qualification', kind: 'text', max: 200, size: 20 },
    { name: 'level', label: 'Level', kind: 'vocab', vocab: 'education_levels' },
    { name: 'country', label: 'Country', kind: 'country' },
    { name: 'started_on', label: 'From', kind: 'date' },
    { name: 'ended_on', label: 'To', kind: 'date' },
    // Last, because it is the answer the row builds to. Asked for on 12
    // September 2026: *"another box - whether complete or incomplete."* It is
    // most of the point of an education history — a qualification claimed on an
    // application has to be finished, and a year abandoned is still a year to
    // account for. Without it a row said somebody attended and left the reader
    // to guess whether they came out with anything.
    { name: 'completed', label: 'Finished', kind: 'vocab', vocab: 'education_outcomes' },
  ],
};

export const TRAVEL_HISTORY: HistoryDef = {
  key: 'travel',
  table: 'client_travel',
  title: 'Travel history',
  noun: 'trip',
  showsGaps: false,
  columns: [
    { name: 'country', label: 'Country', kind: 'country' },
    // Asked for on 12 September 2026: *"the purpose should contain options
    // Family, Holiday, Business, Work, and another field - mode of travel
    // should have by Air, Sea, Land."* Both are lists an administrator edits,
    // like every other dropdown here. `purpose` was free text for a day and
    // held nothing, so it became a list directly rather than through a
    // translation nobody would have needed.
    { name: 'purpose', label: 'Purpose', kind: 'vocab', vocab: 'travel_purposes' },
    { name: 'mode', label: 'By', kind: 'vocab', vocab: 'travel_modes' },
    { name: 'port_of_entry', label: 'Port of entry', kind: 'text', max: 120, size: 16 },
    { name: 'started_on', label: 'Arrived', kind: 'date' },
    { name: 'ended_on', label: 'Left', kind: 'date' },
  ],
};

export const HISTORIES: HistoryDef[] = [EMPLOYMENT_HISTORY, EDUCATION_HISTORY, TRAVEL_HISTORY];

export function historyByKey(key: string): HistoryDef | undefined {
  return HISTORIES.find((h) => h.key === key);
}

export interface HistoryRow {
  id: string;
  position: number;
  notes: string | null;
  [column: string]: string | number | null;
}

export async function historyRows(
  env: Env, def: HistoryDef, clientId: string,
): Promise<HistoryRow[]> {
  return all<HistoryRow>(
    env.DB,
    `SELECT * FROM ${def.table} WHERE client_id = ? ORDER BY position, created_at`,
    clientId,
  );
}

/** Every history a client holds, read in one go for the client page. */
export async function allHistories(
  env: Env, clientId: string,
): Promise<Record<HistoryKey, HistoryRow[]>> {
  const [employment, education, travel] = await Promise.all(
    HISTORIES.map((def) => historyRows(env, def, clientId)));
  return {
    employment: employment ?? [], education: education ?? [], travel: travel ?? [],
  };
}

/**
 * The spaces between periods that do not meet.
 *
 * *"IF AI is filling it in - it must leave blank space if there is a gap."* A
 * gap is shown, never refused: a history part-way through entry legitimately
 * has them, and a gap in a work history is often the true answer — which is why
 * an unemployed period is a row of its own here rather than an absence.
 *
 * Returned as the index each gap sits *before*, so the page can draw a line
 * between two rows without the rows knowing about it. Rows are compared in the
 * order the practice put them in, so reordering a table changes what reads as a
 * gap — which is right: the order is the claim being made.
 *
 * A day between two periods is not a gap. A month is. The threshold is
 * deliberately loose, because a person who left one job on the Friday and
 * started the next on the Monday has not been unemployed, and an alert about it
 * would be the kind of noise the practice has asked twice not to have.
 */
/**
 * A date in a history, which may be a day or a month.
 *
 * **Asked for on 12 September 2026:** *"in the histories - can we allow filling
 * in only the Month and year if the date is not available?"* Yes, and it is the
 * ordinary case: a person remembers leaving a job in March 2019, an application
 * form asks for MM/YYYY, a reference letter says "June 2015 to August 2018".
 *
 * Migration 0089 said to use the 1st where the day was unknown, which is the
 * register writing down a day nobody said. A history full of 1sts reads as
 * precision that is not there.
 *
 * Both live in the same column. The string says which it is by being seven
 * characters or ten — a second column saying so could disagree with the date
 * beside it, and `2019-03-15` marked "month only" is a state with no meaning.
 */
export const HISTORY_DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

export function isMonthOnly(value: string): boolean {
  return value.length === 7;
}

/**
 * A history date as an instant, for arithmetic.
 *
 * A month is not a point, so which end of it is meant depends on what the date
 * *is*. A period that started in March 2019 started at the beginning of March;
 * one that ended in March 2019 ran to the end of it. Reading both as the 1st
 * would invent a month-long gap after every period that ends in a month.
 *
 * This is the only place that arithmetic lives. Nothing else widens a month.
 */
export function historyDateAt(value: string | null, end: boolean): number | null {
  if (!value || !HISTORY_DATE_RE.test(value)) return null;
  if (!isMonthOnly(value)) return Date.parse(`${value}T00:00:00Z`);
  const [y, m] = value.split('-').map(Number) as [number, number];
  // Day 0 of the next month is the last day of this one, which is also how
  // February and a leap year are got right without knowing about either.
  return end ? Date.UTC(y, m, 0) : Date.UTC(y, m - 1, 1);
}

export const GAP_DAYS = 31;

export function gapsIn(rows: HistoryRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (let i = 1; i < rows.length; i += 1) {
    // The rows are read in the practice's order, which may run either way in
    // time. Whichever of the two dates is earlier is where the gap starts.
    const prevEnd = rows[i - 1]!.ended_on as string | null;
    const nextStart = rows[i]!.started_on as string | null;
    const prevStart = rows[i - 1]!.started_on as string | null;
    const nextEnd = rows[i]!.ended_on as string | null;

    const pair = prevEnd && nextStart && prevEnd <= nextStart
      ? [prevEnd, nextStart]
      : nextEnd && prevStart && nextEnd <= prevStart
        ? [nextEnd, prevStart]
        : null;
    if (!pair) continue;

    // The earlier of the pair is an end and the later is a start, whichever way
    // round the practice ordered the table — so a month at the earlier end is
    // read as its last day and one at the later end as its first. That is the
    // narrowest honest reading of the gap between them.
    const from = historyDateAt(pair[0]!, true);
    const to = historyDateAt(pair[1]!, false);
    if (from === null || to === null) continue;
    const days = Math.round((to - from) / 86_400_000);
    if (Number.isFinite(days) && days > GAP_DAYS) out.set(i, days);
  }
  return out;
}

/** Read one row's worth of values out of a form, for an add. */
export function readHistoryRow(
  def: HistoryDef, f: FormReader, suffix = '',
): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const col of def.columns) {
    const name = `${col.name}${suffix}`;
    if (col.kind === 'date') {
      // Read as text and checked against the shape, rather than through
      // `f.date`, which knows only `YYYY-MM-DD`. The database holds the same
      // rule (migration 0091); this is here so the message names the box.
      const raw = (f.optional(name, { max: 10 }) ?? '').trim();
      if (raw && !HISTORY_DATE_RE.test(raw)) {
        f.errors[name] = `${col.label} is a day or a month — 2019-03-15, or 2019-03.`;
        values[col.name] = null;
      } else {
        values[col.name] = raw || null;
      }
    } else {
      values[col.name] = f.optional(name, { max: col.max ?? 200 });
    }
  }
  values.notes = f.optional(`notes${suffix}`, { max: HISTORY_NOTE_MAX });
  return values;
}

export async function addHistoryRow(
  env: Env, def: HistoryDef, clientId: string,
  values: Record<string, string | null>, userId: string | null,
): Promise<string> {
  const id = newId(def.key.slice(0, 3));
  const cols = [...def.columns.map((c) => c.name), 'notes'];
  // New rows go to the end, which is where somebody adding one expects to find
  // it. Reordering is the next press, not this one.
  const next = await all<{ n: number }>(
    env.DB, `SELECT COALESCE(MAX(position), 0) + 1 AS n FROM ${def.table} WHERE client_id = ?`,
    clientId);
  await run(
    env.DB,
    `INSERT INTO ${def.table} (id, client_id, position, ${cols.join(', ')},
        created_at, updated_at, created_by)
     VALUES (?, ?, ?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`,
    id, clientId, next[0]?.n ?? 1, ...cols.map((c) => values[c] ?? null),
    nowIso(), nowIso(), userId,
  );
  return id;
}

export interface HistorySave { changed: number; removed: number }

/**
 * Save the whole table at once.
 *
 * Removals first, so a row ticked out is not also updated on its way to being
 * deleted — which would be two writes saying different things about the same
 * row, and the second one wasted.
 *
 * Every remaining row is written whether or not it changed. The alternative is
 * to compare each field and skip the ones that match, which reads nicer and
 * saves nothing: these tables hold a handful of rows per client, and a
 * comparison that gets one column wrong silently drops an edit.
 */
export async function saveHistory(
  env: Env, def: HistoryDef, clientId: string, f: FormReader,
): Promise<HistorySave> {
  const rows = await historyRows(env, def, clientId);

  // Every row read before anything is written.
  //
  // The save is a row at a time, so a bad date on the fourth row would
  // otherwise be found after three rows had already been written — a half-saved
  // table, and the reader has no way to tell which half. Reading first costs a
  // second pass over the form and makes the save all-or-nothing.
  const proposed = new Map<string, Record<string, string | null>>();
  for (const row of rows) {
    if (f.checkbox(`remove_${row.id}`)) continue;
    proposed.set(row.id, readHistoryRow(def, f, `_${row.id}`));
  }
  if (!f.valid) return { changed: 0, removed: 0 };

  let removed = 0;
  let changed = 0;

  for (const row of rows) {
    if (f.checkbox(`remove_${row.id}`)) {
      await run(env.DB, `DELETE FROM ${def.table} WHERE id = ? AND client_id = ?`, row.id, clientId);
      removed += 1;
    }
  }

  const keeping = rows.filter((r) => !f.checkbox(`remove_${r.id}`));
  for (const row of keeping) {
    const values = proposed.get(row.id)!;
    // Read as text rather than through `int`, which would record a validation
    // error and refuse the whole save over one mistyped order box. A number
    // that makes no sense means "leave this row where it was".
    const typed = Number(f.optional(`position_${row.id}`, { max: 5 }) ?? '');
    const position = Number.isFinite(typed) && typed > 0 ? Math.min(typed, 9999) : row.position;
    const cols = [...def.columns.map((c) => c.name), 'notes'];
    await run(
      env.DB,
      `UPDATE ${def.table} SET position = ?, ${cols.map((c) => `${c} = ?`).join(', ')},
              updated_at = ?
        WHERE id = ? AND client_id = ?`,
      position, ...cols.map((c) => values[c] ?? null), nowIso(), row.id, clientId,
    );
    changed += 1;
  }
  return { changed, removed };
}
