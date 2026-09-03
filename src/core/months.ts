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

/**
 * The Monday of the week a date falls in.
 *
 * Weeks run Monday to Sunday here, so a Sunday belongs to the week that started
 * six days earlier — not to the one beginning the next day. That is the case
 * a naive implementation gets wrong, and it gets it wrong for exactly one day
 * in seven, which is how it survives a casual check.
 */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The seven days of the week containing this date, Monday first. */
export function weekDays(date: string): string[] {
  const start = new Date(`${weekStart(date)}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** A date a whole number of days away, staying in UTC. */
export function shiftDate(date: string, byDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + byDays);
  return d.toISOString().slice(0, 10);
}

/** A day a query asked for, or nothing when it asked for nonsense. */
export function validDate(asked: string | undefined): string | null {
  if (!asked || !/^\d{4}-\d{2}-\d{2}$/.test(asked)) return null;
  const d = new Date(`${asked}T00:00:00Z`);
  // The shape is not enough: 2026-02-30 matches it and is not a day.
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== asked) return null;
  const year = Number(asked.slice(0, 4));
  return year >= 1900 && year <= 2200 ? asked : null;
}

/** "1–7 September 2026", or across a month or year boundary. */
export function weekName(date: string): string {
  const days = weekDays(date);
  const first = new Date(`${days[0]}T00:00:00Z`);
  const last = new Date(`${days[6]}T00:00:00Z`);
  const opts = { timeZone: 'UTC' } as const;
  const sameMonth = days[0]!.slice(0, 7) === days[6]!.slice(0, 7);
  const sameYear = days[0]!.slice(0, 4) === days[6]!.slice(0, 4);
  const dayOf = (d: Date) => d.toLocaleDateString('en-NZ', { day: 'numeric', ...opts });
  const monthOf = (d: Date) => d.toLocaleDateString('en-NZ', { month: 'long', ...opts });
  const yearOf = (d: Date) => d.getUTCFullYear();
  if (sameMonth) return `${dayOf(first)}–${dayOf(last)} ${monthOf(last)} ${yearOf(last)}`;
  if (sameYear) return `${dayOf(first)} ${monthOf(first)} – ${dayOf(last)} ${monthOf(last)} ${yearOf(last)}`;
  return `${dayOf(first)} ${monthOf(first)} ${yearOf(first)} – ${dayOf(last)} ${monthOf(last)} ${yearOf(last)}`;
}

/** A year a query asked for, or the fallback when it asked for nonsense. */
export function validYear(asked: string | undefined, fallback: number): number {
  if (!asked || !/^\d{4}$/.test(asked)) return fallback;
  const year = Number(asked);
  return year >= 1900 && year <= 2200 ? year : fallback;
}

/** The twelve month keys of a year, January first. */
export function yearMonths(year: number): MonthKey[] {
  return Array.from({ length: 12 }, (_, i) => `${String(year).padStart(4, '0')}-${pad(i + 1)}`);
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** "September 2026", for a heading. */
export function monthName(key: MonthKey): string {
  return new Date(`${firstDay(key)}T00:00:00Z`)
    .toLocaleDateString('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
