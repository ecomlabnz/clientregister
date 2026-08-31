/**
 * How much of a list to show at once, and how to reach the rest.
 *
 * Every long list in the register — clients, cases, tasks — had the same two
 * buttons and no way to say "just show me all of them". The choice existed, but
 * only in Settings, three clicks from the list a person was actually looking
 * at. This puts it under the list, where the question is asked.
 *
 * Two rules worth stating, because both are easy to get wrong:
 *
 *  1. **The size is an allow-list, not a number.** It arrives in the address,
 *     so `?size=1000000` would otherwise ask D1 for a million rows and the
 *     browser to lay them out — a page anybody with a link could hang. A value
 *     that is not one of the offered sizes is ignored rather than clamped,
 *     which also means a stale bookmark degrades to the default instead of to
 *     something arbitrary.
 *  2. **Changing the size returns to page one.** Page 3 of 25 and page 3 of 100
 *     hold different rows, so keeping the number lands somewhere nobody asked
 *     for — the same reasoning the tables already apply to sorting.
 */

import { html, type Raw } from './html';

/**
 * The sizes offered. 500 is the ceiling deliberately: mobile-friendliness
 * ranks ahead of saving a click, and a table of a thousand rows is slow to
 * lay out on a phone even when the query is fast.
 */
export const PAGE_SIZES = [25, 50, 100, 250, 500] as const;

export const DEFAULT_PAGE_SIZE = 25;

/** The address wins over the preference; the preference wins over the default. */
export function pageSizeFor(fromQuery?: string, fromPreference?: string): number {
  for (const candidate of [fromQuery, fromPreference]) {
    if (candidate === undefined) continue;
    const n = Number(candidate);
    if (Number.isInteger(n) && (PAGE_SIZES as readonly number[]).includes(n)) return n;
  }
  return DEFAULT_PAGE_SIZE;
}

/**
 * A page number that cannot be used to walk off the end of the table.
 *
 * The offset is `(page - 1) * size`, so an unbounded page number is an
 * unbounded offset — cheap for SQLite to refuse but pointless to ask.
 */
export function pageNumberFor(value?: string): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export interface PagerOpts {
  /** The page being shown, from 1. */
  page: number;
  /** Rows per page, already through `pageSizeFor`. */
  size: number;
  /** True when the query found at least one row beyond this page. */
  hasMore: boolean;
  /** How many rows this page actually shows. */
  shown: number;
  /** Builds an address for this list with some parameters replaced. */
  href: (over: Record<string, string | number>) => string;
}

/**
 * Previous / Next, the range on screen, and the rows-per-page choice.
 *
 * The range is stated without a total because a total costs a second query
 * over the whole table on every page view. "Showing 26–50" answers where you
 * are; "of 4,312" would answer a question nobody asked at the price of the
 * page being slower for everyone.
 */
export function pager(o: PagerOpts): Raw {
  const first = (o.page - 1) * o.size + 1;
  const last = first + o.shown - 1;
  return html`
    <div class="pager">
      <div class="pager-steps">
        ${o.page > 1
          ? html`<a class="btn btn-secondary" href="${o.href({ page: o.page - 1 })}">Previous</a>`
          : ''}
        ${o.hasMore
          ? html`<a class="btn btn-secondary" href="${o.href({ page: o.page + 1 })}">Next</a>`
          : ''}
      </div>
      ${o.shown > 0
        ? html`<div class="pager-range muted small">Showing ${String(first)}–${String(last)}</div>`
        : ''}
      <div class="pager-size">
        <span class="muted small">Rows</span>
        ${PAGE_SIZES.map((n) => (n === o.size
          ? html`<span class="pager-size-current" aria-current="true">${String(n)}</span>`
          : html`<a href="${o.href({ size: n, page: 1 })}">${String(n)}</a>`))}
      </div>
    </div>`;
}

/**
 * One more row than the page needs.
 *
 * "Is there a next page" is then answered by the same query rather than by a
 * second COUNT over the whole table.
 */
export function limitFor(size: number): number {
  return size + 1;
}
