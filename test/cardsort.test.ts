import { describe, expect, it } from 'vitest';
import { sortCard } from '../src/ui/cardsort';

/**
 * Click a heading to sort by it; click again to reverse.
 *
 * The practice asked for this on 3 September, having found two whole-card
 * orderings interchangeable — both were by date, so a visa expiry five hundred
 * days overdue led the list either way. What was wanted was the ordinary thing
 * a table does.
 */

interface Row { title: string; client: string; due: string | null; rank: number }

const rows: Row[] = [
  { title: 'Beta', client: 'Zeta', due: '2026-09-10', rank: 2 },
  { title: 'alpha', client: 'Alpha', due: '2026-09-01', rank: 1 },
  { title: 'Gamma', client: 'Mid', due: null, rank: 3 },
];

const columns = [
  { key: 'title', value: (r: Row) => r.title },
  { key: 'client', value: (r: Row) => r.client },
  { key: 'due', value: (r: Row) => r.due },
  { key: 'rank', value: (r: Row) => r.rank },
];

const href = (over: Record<string, string>) =>
  `/?${new URLSearchParams(over).toString()}`;
const run = (asked: { key?: string; dir?: string }, fallback?: (a: Row, b: Row) => number) =>
  sortCard(rows, columns, asked, href, { key: 'k', dir: 'd' }, fallback);

describe('sorting a card by one of its columns', () => {
  it('sorts ascending by default', () => {
    expect(run({ key: 'client' }).rows.map((r) => r.client)).toEqual(['Alpha', 'Mid', 'Zeta']);
  });

  it('reverses when asked', () => {
    expect(run({ key: 'client', dir: 'desc' }).rows.map((r) => r.client)).toEqual(['Zeta', 'Mid', 'Alpha']);
  });

  it('ignores case, so a lowercase title does not sort after everything', () => {
    // "alpha" must sit beside "Beta", not below "Gamma".
    expect(run({ key: 'title' }).rows.map((r) => r.title)).toEqual(['alpha', 'Beta', 'Gamma']);
  });

  it('sorts numbers as numbers, not as text', () => {
    // The reason priority is ranked rather than compared as a word.
    const many: Row[] = [2, 10, 1].map((n) => ({ title: `t${n}`, client: 'c', due: null, rank: n }));
    const out = sortCard(many, columns, { key: 'rank' }, href, { key: 'k', dir: 'd' });
    expect(out.rows.map((r) => r.rank)).toEqual([1, 2, 10]);
  });

  it('puts rows with nothing in that column last, whichever way it points', () => {
    // A row with no due date is not "earliest" — it is unknown, and burying it
    // under today's work is how it stays unknown. Reversing a list must not
    // promote the rows that say nothing.
    expect(run({ key: 'due' }).rows.at(-1)!.due).toBeNull();
    expect(run({ key: 'due', dir: 'desc' }).rows.at(-1)!.due).toBeNull();
  });

  it('uses the card’s own default when no column is chosen', () => {
    const byRankDesc = (a: Row, b: Row) => b.rank - a.rank;
    expect(run({}, byRankDesc).rows.map((r) => r.rank)).toEqual([3, 2, 1]);
    expect(run({ key: 'nonsense' }, byRankDesc).rows.map((r) => r.rank)).toEqual([3, 2, 1]);
  });

  it('leaves the rows alone when there is no column and no default', () => {
    expect(run({}).rows.map((r) => r.title)).toEqual(rows.map((r) => r.title));
  });

  it('never mutates the caller’s array', () => {
    // Three cards share this helper on one page; a sort that reordered in place
    // would reorder somebody else's list.
    const before = rows.map((r) => r.title);
    run({ key: 'client', dir: 'desc' });
    expect(rows.map((r) => r.title)).toEqual(before);
  });

  it('refuses a sort key that is not a column', () => {
    // The key arrives in the address bar. Anything reaching a comparison from
    // there has to come off an allow-list.
    const out = run({ key: "title'; DROP TABLE cases; --" });
    expect(out.key).toBe('');
    expect(out.rows.map((r) => r.title)).toEqual(rows.map((r) => r.title));
  });

  it('treats any direction but desc as ascending', () => {
    for (const dir of ['asc', '', 'DESC', 'sideways', undefined]) {
      expect(run({ key: 'client', dir: dir as never }).dir,
             `${dir} should not reverse`).toBe(dir === 'desc' ? 'desc' : 'asc');
    }
  });

  it('hands the table a link that carries the key and the direction', () => {
    const out = run({ key: 'client' });
    expect(out.table.href('due', 'desc')).toContain('k=due');
    expect(out.table.href('due', 'desc')).toContain('d=desc');
  });

  it('is a stable, total order — the same rows come back the same way', () => {
    const once = run({ key: 'client' }).rows.map((r) => r.client);
    const twice = sortCard([...rows].reverse(), columns, { key: 'client' }, href, { key: 'k', dir: 'd' })
      .rows.map((r) => r.client);
    expect(once).toEqual(twice);
  });
});
