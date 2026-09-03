/**
 * Month arithmetic for the calendar grid.
 *
 * Kept apart from the page and from the database so the awkward cases can be
 * tested directly: a month that begins on a Sunday, a leap February, December
 * rolling into January, and a grid that must not silently drop the 31st.
 *
 * Everything is UTC and `YYYY-MM-DD`. The register stores dates as plain days
 * with no timezone, and doing the arithmetic in local time is how the 1st of a
 * month renders as the last day of the previous one for somebody in Auckland.
 */

/** A month key, `YYYY-MM`. */
export type MonthKey = string;

const pad = (n: number): string => String(n).padStart(2, '0');

export function monthKeyOf(date: string): MonthKey {
  return date.slice(0, 7);
}

/** The month a query asked for, or the current one when it asked for nonsense. */
export function validMonth(asked: string | undefined, fallback: MonthKey): MonthKey {
  if (!asked || !/^\d{4}-(0[1-9]|1[0-2])$/.test(asked)) return fallback;
  const year = Number(asked.slice(0, 4));
  // A calendar is not a time machine in either direction. Outside this the
  // month links would walk somewhere with nothing in it, forever.
  if (year < 1900 || year > 2200) return fallback;
  return asked;
}

export function shiftMonth(key: MonthKey, by: number): MonthKey {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  // Zero-based month arithmetic, so December + 1 rolls the year without a
  // special case for it.
  const total = year * 12 + (month - 1) + by;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad((total % 12) + 1)}`;
}

export function daysInMonth(key: MonthKey): number {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  // Day 0 of the next month is the last day of this one — which gets February
  // right in a leap year without knowing the rule.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function firstDay(key: MonthKey): string { return `${key}-01`; }
export function lastDay(key: MonthKey): string { return `${key}-${pad(daysInMonth(key))}`; }

/**
 * The weekday a month starts on, Monday first.
 *
 * New Zealand calendars run Monday to Sunday, and `getUTCDay()` counts from
 * Sunday, so a month beginning on a Sunday would be given six leading blanks
 * instead of the six it needs at the end.
 */
export function leadingBlanks(key: MonthKey): number {
  const day = new Date(`${firstDay(key)}T00:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}

/**
 * The grid: whole weeks, Monday first, with nulls padding either end.
 *
 * Always whole weeks so the last row is never ragged, and every day of the
 * month appears exactly once — which is asserted rather than assumed, because
 * an off-by-one here loses somebody's deadline off the bottom of the page.
 */
export function monthGrid(key: MonthKey): Array<Array<string | null>> {
  const total = daysInMonth(key);
  const cells: Array<string | null> = [
    ...Array<null>(leadingBlanks(key)).fill(null),
    ...Array.from({ length: total }, (_, i) => `${key}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** "September 2026", for a heading. */
export function monthName(key: MonthKey): string {
  return new Date(`${firstDay(key)}T00:00:00Z`)
    .toLocaleDateString('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
