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

/**
 * A date that may be a month: `2019-03-15` or `2019-03`.
 *
 * Used by the histories, where the day is often genuinely not known — see
 * `core/histories.ts`. A month renders as "Mar 2019" rather than as a day
 * somebody would then read as recorded.
 */
export function historyDate(value: string | null | undefined): string {
  if (!value) return '—';
  if (value.length === 7) {
    const d = new Date(`${value}-01T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-NZ', {
      month: 'short', year: 'numeric', timeZone: TZ,
    }).format(d);
  }
  return dateShort(value);
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
 * A date written out in full, for prose rather than for a column.
 *
 * "15 September 2026", not "15 Sept 2026". A date inside a sentence a client
 * reads once — the day a quotation closes — is worth the extra characters; a
 * date in a table of a hundred rows is not, which is what `dateShort` is for.
 */
export function dateLong(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-NZ', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ,
  }).format(d);
}

/**
 * The moment a document was produced, in full, for the foot of that document.
 *
 * **Asked for on 9 September 2026:** *"it is better if — when Print button is
 * clicked — a clean PDF is generated with full date and time stamp."* A
 * quotation and a letter of engagement are revised before they go out, and two
 * printings of the same reference are otherwise indistinguishable once they are
 * on paper. The reference says which document; this says which printing of it.
 *
 * Long-form and unambiguous, because it is read off paper by somebody who may
 * be holding two copies: the day named, the month in words, the year, the time
 * to the minute, and the time zone said rather than assumed.
 */
export function printedAt(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-NZ', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: TZ,
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

/**
 * Age in completed years on a given day, or null when there is no date of birth.
 *
 * Counted by calendar rather than by dividing days, because the answers the
 * practice needs are calendar answers: a dependent child is under 25 on the day
 * the application is lodged, not 24.97 years old. Leap years take care of
 * themselves — 29 February becomes 1 March in a year that has no 29th, which is
 * the reading every New Zealand age threshold uses.
 */
export function ageYears(dateOfBirth: string | null | undefined,
                         on: string | Date = new Date()): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  const day = typeof on === 'string' ? new Date(`${on.slice(0, 10)}T00:00:00Z`) : on;
  if (Number.isNaN(day.getTime())) return null;
  let years = day.getUTCFullYear() - born.getUTCFullYear();
  const monthsIn = day.getUTCMonth() - born.getUTCMonth();
  if (monthsIn < 0 || (monthsIn === 0 && day.getUTCDate() < born.getUTCDate())) years -= 1;
  return years < 0 ? null : years;
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
