/**
 * How much of a list is shown, and how the rest is reached.
 *
 * Two things here are guards rather than conveniences, and both are tested by
 * asking what happens when they are attacked rather than by asking what the
 * page looks like:
 *
 *  - The page size arrives in the address. Left as a plain integer, `?size=`
 *    is a request for as many rows as the sender likes, from anybody holding a
 *    link — so it is an allow-list, and anything else falls back rather than
 *    being clamped to something arbitrary.
 *  - The offered sizes are declared twice, once for the lists and once for the
 *    preferences page. A size offered in Settings that a list will not accept
 *    is a setting that silently does nothing, so the two lists are pinned to
 *    each other.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageNumberFor, pageSizeFor, pager } from '../src/ui/pager';
import { PREFERENCE_GROUPS } from '../src/core/preferences';

describe('the page size that arrives in the address', () => {
  it('takes a size that is actually offered', () => {
    for (const n of PAGE_SIZES) expect(pageSizeFor(String(n), undefined)).toBe(n);
  });

  it('refuses a size nobody offered, however it is written', () => {
    // The first of these is the one that matters: a page asked to lay out a
    // million rows is a page anybody with a link can hang.
    for (const bad of ['1000000', '99999', '26', '0', '-50', '1e3', '25.0', ' 25 ',
                       'all', '', 'NaN', 'Infinity', '25; DROP TABLE clients']) {
      expect(pageSizeFor(bad, undefined)).toBe(DEFAULT_PAGE_SIZE);
    }
  });

  it('falls back to the preference, and then to the default', () => {
    expect(pageSizeFor(undefined, '100')).toBe(100);
    expect(pageSizeFor(undefined, undefined)).toBe(DEFAULT_PAGE_SIZE);
    // A preference holding something no longer offered degrades rather than
    // stranding somebody on a size the lists will not honour.
    expect(pageSizeFor(undefined, '75')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('lets the address win over the preference', () => {
    expect(pageSizeFor('250', '25')).toBe(250);
  });

  it('does not offer a size big enough to be the whole table', () => {
    // Mobile-friendliness ranks ahead of saving a click; a five-figure page is
    // slow to lay out however fast the query was.
    expect(Math.max(...PAGE_SIZES)).toBeLessThanOrEqual(500);
  });
});

describe('the page number that arrives in the address', () => {
  it('takes a real page', () => {
    expect(pageNumberFor('1')).toBe(1);
    expect(pageNumberFor('7')).toBe(7);
  });

  it('refuses anything that is not one', () => {
    for (const bad of ['0', '-1', '1.5', 'two', '', undefined, '10001', '1e9']) {
      expect(pageNumberFor(bad)).toBe(1);
    }
  });
});

describe('the pager under a list', () => {
  const href = (over: Record<string, string | number> = {}) =>
    `/x?${new URLSearchParams(Object.fromEntries(
      Object.entries({ page: 2, size: 25, ...over }).map(([k, v]) => [k, String(v)]))).toString()}`;

  const render = (o: Partial<Parameters<typeof pager>[0]> = {}) =>
    pager({ page: 2, size: 25, hasMore: true, shown: 25, href, ...o }).value;

  it('offers every size, and marks the one in use', () => {
    const out = render({ size: 100 });
    for (const n of PAGE_SIZES) expect(out).toContain(String(n));
    expect(out).toContain('<span class="pager-size-current" aria-current="true">100</span>');
    // The one in use is not also a link to itself.
    expect(out).not.toMatch(/<a[^>]*>100<\/a>/);
  });

  it('returns to page one when the size changes', () => {
    // Page 3 of 25 and page 3 of 100 hold different rows, so keeping the
    // number lands somewhere nobody asked for.
    const out = pager({ page: 3, size: 25, hasMore: true, shown: 25, href }).value;
    const link = /href="([^"]*size=100[^"]*)"/.exec(out)?.[1] ?? '';
    expect(link).toContain('page=1');
    expect(link).not.toContain('page=3');
  });

  it('says where in the list the reader is, without counting the whole table', () => {
    expect(render({ page: 2, size: 25, shown: 25 })).toContain('Showing 26–50');
    expect(render({ page: 1, size: 50, shown: 12 })).toContain('Showing 1–12');
  });

  it('offers Previous only when there is one, and Next only when there is more', () => {
    const first = render({ page: 1, hasMore: false, shown: 3 });
    expect(first).not.toContain('Previous');
    expect(first).not.toContain('Next');
    const middle = render({ page: 2, hasMore: true });
    expect(middle).toContain('Previous');
    expect(middle).toContain('Next');
  });

  it('says nothing about a range when the list is empty', () => {
    const out = render({ page: 1, hasMore: false, shown: 0 });
    expect(out).not.toContain('Showing');
    // The size choice is still there, because "nothing here" is sometimes the
    // filter rather than the length.
    expect(out).toContain('pager-size');
  });
});

describe('the two places the sizes are written', () => {
  it('offer exactly the same sizes', () => {
    // A size offered in Settings that no list accepts is a setting that
    // silently does nothing; a size a list accepts but Settings does not
    // offer cannot be made to stick.
    const group = PREFERENCE_GROUPS.flatMap((g) => g.preferences)
      .find((s) => s.key === 'pref.page_size');
    expect(group).toBeDefined();
    expect(group!.options!.map((o) => Number(o.value)).sort((a, b) => a - b))
      .toEqual([...PAGE_SIZES].sort((a, b) => a - b));
  });

  it('agree on where a list starts', () => {
    const group = PREFERENCE_GROUPS.flatMap((g) => g.preferences)
      .find((s) => s.key === 'pref.page_size');
    expect(Number(group!.default)).toBe(DEFAULT_PAGE_SIZE);
  });
});
