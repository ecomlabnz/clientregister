/**
 * Sorting a card on the dashboard by one of its columns.
 *
 * The practice asked for this on 3 September, having found that two orderings
 * "nothing really changes when switching" — both were by date, so a visa expiry
 * five hundred days overdue led the list either way. What was wanted was the
 * ordinary thing a table does: click a heading to sort by it, click again to
 * reverse.
 *
 * Three cards needed it and each could have grown its own. One helper instead,
 * because three implementations of "click to sort" drift into three behaviours
 * — and the one that drifts is always the second click.
 */

/** How to read one sortable column out of a row. */
export interface CardColumn<T> {
  /** The key that appears in the address bar. Never SQL. */
  key: string;
  /**
   * What to compare. A string sorts as text, a number as a number, and `null`
   * sorts last in either direction — a row with no due date is not "earliest",
   * it is unknown, and burying it under today's work is how it stays unknown.
   */
  value: (row: T) => string | number | null;
}

export interface CardSort<T> {
  key: string;
  dir: 'asc' | 'desc';
  /** Rows in the chosen order. */
  rows: T[];
  /** For the table helper, which draws the arrows. */
  table: { key: string; dir: 'asc' | 'desc'; href: (key: string, dir: 'asc' | 'desc') => string };
}

/**
 * Apply a column sort to a card's rows.
 *
 * `fallback` is the order used when nothing has been chosen — the card's own
 * idea of a sensible default, which is not always a column (the working order
 * on "Needs you today" is not one).
 */
export function sortCard<T>(
  rows: T[],
  columns: Array<CardColumn<T>>,
  asked: { key?: string; dir?: string },
  href: (over: Record<string, string>) => string,
  param: { key: string; dir: string },
  fallback?: (a: T, b: T) => number,
): CardSort<T> {
  const column = columns.find((c) => c.key === asked.key);
  const key = column ? column.key : '';
  const dir: 'asc' | 'desc' = asked.dir === 'desc' ? 'desc' : 'asc';

  const sorted = column
    ? [...rows].sort((a, b) => {
        const av = column.value(a);
        const bv = column.value(b);
        // Unknown last, whichever way the column is pointing. Reversing a list
        // should not promote the rows that say nothing.
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), 'en-NZ', { numeric: true, sensitivity: 'base' });
        return dir === 'desc' ? -cmp : cmp;
      })
    : (fallback ? [...rows].sort(fallback) : rows);

  return {
    key, dir, rows: sorted,
    table: {
      key, dir,
      // Clicking the column already sorted reverses it; clicking another starts
      // it ascending, which is what a person means by "sort by this".
      href: (k, d) => href({ [param.key]: k, [param.dir]: d }),
    },
  };
}
