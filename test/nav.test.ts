/**
 * The bar across the top.
 *
 * It reached twelve items and wrapped onto a second line, which is the point
 * at which a navigation stops being scannable — you read it instead of
 * glancing at it. The practice weighed a collapsible sidebar against grouping
 * on 31 August 2026 and chose grouping: a sidebar costs horizontal width
 * permanently on pages whose defining feature is wide tables, to save vertical
 * space once.
 *
 * What is pinned here is the property, not the arrangement: the bar stays
 * small enough to glance at, and grouping never loses a destination.
 */

import { describe, expect, it } from 'vitest';
import { navEntries, type NavItem } from '../src/core/module';
import { registeredModules } from '../src/registry';
import { collectNav } from '../src/core/module';

const item = (label: string, extra: Partial<NavItem> = {}): NavItem =>
  ({ href: `/${label.toLowerCase()}`, label, ...extra });

describe('collecting the bar', () => {
  it('leaves ungrouped items exactly where they were', () => {
    const out = navEntries([item('Dashboard'), item('Cases')]);
    expect(out.map((e) => (e.kind === 'item' ? e.item.label : e.label)))
      .toEqual(['Dashboard', 'Cases']);
  });

  it('gathers a group at the position of its first member', () => {
    const out = navEntries([
      item('Dashboard'), item('Quotes', { group: 'Money' }),
      item('Cases'), item('Fees', { group: 'Money' }),
    ]);
    expect(out.map((e) => (e.kind === 'item' ? e.item.label : e.label)))
      .toEqual(['Dashboard', 'Money', 'Cases']);
    const money = out.find((e) => e.kind === 'group');
    expect(money && money.kind === 'group' && money.items.map((i) => i.label))
      .toEqual(['Quotes', 'Fees']);
  });

  it('loses nothing: every item is still reachable somewhere', () => {
    // The failure that would matter — a page you can no longer get to.
    const items = [item('A'), item('B', { group: 'G' }), item('C', { group: 'G' }), item('D')];
    const flat = navEntries(items).flatMap((e) => (e.kind === 'item' ? [e.item] : e.items));
    expect(flat.map((i) => i.label).sort()).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('the bar the register actually ships', () => {
  const all = collectNav(registeredModules);
  const run = all.filter((i) => !i.corner);
  const entries = navEntries(run);

  it('stays small enough to glance at', () => {
    // Twelve wrapped onto a second line at the width the practice works at.
    // Eight is the ceiling this was brought under; a ninth needs a group, not
    // an exception.
    expect(entries.length).toBeLessThanOrEqual(8);
  });

  it('still reaches every page it did before', () => {
    const reachable = new Set([
      ...entries.flatMap((e) => (e.kind === 'item' ? [e.item.href] : e.items.map((i) => i.href))),
      ...all.filter((i) => i.corner).map((i) => i.href),
    ]);
    for (const declared of all) {
      expect(reachable.has(declared.href), `${declared.label} is unreachable`).toBe(true);
    }
  });

  it('keeps the daily work in the run and the occasional in the corner', () => {
    const runLabels = entries.map((e) => (e.kind === 'item' ? e.item.label : e.label));
    for (const daily of ['Dashboard', 'Alerts', 'Incoming', 'Clients', 'Cases', 'Tasks']) {
      expect(runLabels, `${daily} should be one glance away`).toContain(daily);
    }
    const corner = all.filter((i) => i.corner).map((i) => i.label).sort();
    expect(corner).toEqual(['Help', 'Settings']);
  });

  it('gives every group more than one item', () => {
    // A group of one is a heading that hides a single link behind a press.
    for (const entry of entries) {
      if (entry.kind === 'group') {
        expect(entry.items.length, `${entry.label} holds only one item`).toBeGreaterThan(1);
      }
    }
  });
});
