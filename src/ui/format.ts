/** Display formatting. The practice runs on New Zealand time and NZD. */

const TZ = 'Pacific/Auckland';

export function money(cents: number | null | undefined, currency = 'NZD'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency }).format(cents / 100);
}

export function dateShort(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ,
  }).format(d);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NZ', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  }).format(d);
}

/**
 * Just the clock time, for a column that shows the date on its own line.
 *
 * A log of a hundred rows reads by date first and time second; putting both in
 * one cell makes a string long enough to wrap, and a wrapped timestamp turns a
 * one-line row into a four-line one.
 */
export function timeShort(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-NZ', {
    hour: '2-digit', minute: '2-digit', timeZone: TZ,
  }).format(d);
}

/**
 * The instant to store for a date somebody typed.
 *
 * A date-only value has to be stored at a moment that falls on that calendar
 * date *in New Zealand*, because that is where it will be read back. Midnight
 * UTC is midday here, which is safely inside the day in either of our offsets;
 * midday UTC would be the small hours of the following morning, and a note
 * backdated to Thursday would appear on Friday.
 */
export function instantForDate(date: string): string {
  return `${date.slice(0, 10)}T00:00:00.000Z`;
}

/** True for a value stored by `instantForDate` — a date, not a moment. */
export function isDateOnly(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.endsWith('T00:00:00.000Z');
}

/** A date on its own where no real time was recorded; date and time otherwise. */
export function dateOrDateTime(value: string | null | undefined): string {
  return isDateOnly(value) ? dateShort(value) : dateTime(value);
}

/** "in 3 days" / "5 days ago" / "today". */
export function relativeDays(value: string | null | undefined, now = Date.now()): string {
  if (!value) return '';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '';
  const days = Math.round((t - now) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export function isOverdue(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const t = Date.parse(value);
  return !Number.isNaN(t) && t < now;
}

/** Value for a `<input type="date">` from a stored date or datetime. */
export function dateInputValue(value: string | null | undefined): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function truncate(text: string | null | undefined, max = 140): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
