import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Every list page wears the same top.
 *
 * A heading, whatever summary figures the page has, then a row of named views
 * with counts, then one filter bar. Cases had no view row at all and six
 * controls jammed on one line; Fees put its date boxes above the figures they
 * narrowed, so the page opened on two empty inputs. Neither was wrong, exactly
 * — they were each written on their own day, and drifted.
 *
 * That drift is the same shape as the search fault, which was written seven
 * times and had to be found six times over. So the shape is asserted here
 * rather than left to whoever writes the eighth list.
 */

const source = (m: string) => readFileSync(`src/modules/${m}/index.ts`, 'utf8');

/** The pages that are a list of records with views across the top. */
const LISTS = ['clients', 'cases', 'tasks', 'quotes', 'invoices', 'knowledge'];

describe('a list page wears the standard top', () => {
  it.each(LISTS)('%s offers named views', (m) => {
    const s = source(m);
    expect(s).toMatch(/viewTabs\(|<nav class="tabs">/);
  });

  it.each(LISTS)('%s puts the views above the filter bar, not inside it', (m) => {
    const s = source(m);
    const views = Math.max(s.indexOf('viewTabs('), s.indexOf('<nav class="tabs">'));
    const filters = s.indexOf('class="filters"');
    expect(views).toBeGreaterThan(-1);
    expect(filters).toBeGreaterThan(-1);
    expect(views).toBeLessThan(filters);
  });

  it('shows the figures before the controls that narrow them', () => {
    // Fees has no views — it is one set of totals over a period — but the
    // ordering rule still holds, and it is the page that broke it.
    const s = source('fees');
    expect(s.indexOf('class="fee-summary"')).toBeLessThan(s.indexOf('class="filters"'));
  });

  it('keeps the view out of the filter bar on cases', () => {
    // The two dropdowns that were really views — "Open only / Everything" and
    // "Anyone / Assigned to me" — are the tabs now. If either comes back as a
    // <select> the bar is back to six controls.
    const s = source('cases');
    expect(s).not.toMatch(/<select name="scope"/);
    expect(s).not.toMatch(/<select name="assigned"/);
  });

  it('carries the view through the filter form, so filtering does not move you', () => {
    // A filter bar that omits the current view posts without it, and the list
    // silently jumps back to the default view. Every page with both must carry
    // it in a hidden field.
    for (const m of LISTS) {
      const s = source(m);
      const form = s.slice(s.indexOf('class="filters"'), s.indexOf('class="filters"') + 900);
      expect(form, `${m} filter form must carry the current view`)
        .toMatch(/<input type="hidden" name="(view|scope|status)"/);
    }
  });

  it('does not offer a Clear that would also clear the view', () => {
    // Clearing filters and being moved to another tab is two things happening
    // for one click. Cases and Knowledge both did this.
    for (const m of ['cases', 'knowledge']) {
      const s = source(m);
      expect(s, `${m} Clear must keep the view`).not.toMatch(/btn-link" href="\/(cases|knowledge)">Clear/);
    }
  });
});

describe('the view row itself', () => {
  it('renders a count beside each view', async () => {
    const { viewTabs } = await import('../src/ui/components');
    const out = viewTabs([
      { id: 'open', label: 'Open', count: 12, href: '/cases?scope=open', current: true },
      { id: 'all', label: 'All', count: 193, href: '/cases?scope=all', current: false },
    ]).value;
    expect(out).toContain('tab current');
    expect(out).toContain('Open');
    expect(out).toContain('12');
    expect(out).toContain('193');
    expect(out).toContain('/cases?scope=all');
  });

  it('omits the count when a view has none rather than printing a zero', async () => {
    const { viewTabs } = await import('../src/ui/components');
    const out = viewTabs([
      { id: 'a', label: 'Read something', href: '/x', current: true },
    ]).value;
    expect(out).not.toContain('<span class="muted">');
  });

  it('escapes a label, because a view can be named from vocabulary', async () => {
    const { viewTabs } = await import('../src/ui/components');
    const out = viewTabs([
      { id: 'a', label: '<script>x</script>', href: '/x', current: false },
    ]).value;
    expect(out).not.toContain('<script>');
  });
});
