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
import { readFileSync } from 'node:fs';
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

/**
 * How the menus behave, as opposed to what is in them.
 *
 * Reported on 31 August 2026, all three at once: the bar grew taller when a
 * menu opened, two menus could be open together, and a menu stayed open after
 * you had moved on. Each has its own cause and its own fix, so each gets its
 * own assertion.
 */
describe('the menus in the bar', () => {
  const css = readFileSync('public/app.css', 'utf8');
  const script = readFileSync('public/app.js', 'utf8');

  it('cannot change the height of the bar when it opens', () => {
    // An open <details> is more than its summary and its panel: the browser
    // wraps what follows the summary in a box of its own, and in Chrome that
    // box is twelve pixels tall even when it holds nothing but an absolutely
    // positioned panel. It also ignores every attempt to style it. So the
    // height is stated instead — the same figure for a menu heading as for a
    // plain link, which is what makes an open menu cost nothing.
    expect(css).toContain('--nav-item-h:');
    const group = css.match(/\.nav-group \{([^}]*)\}/);
    expect(group, 'no .nav-group rule').not.toBeNull();
    expect(group![1]).toContain('height: var(--nav-item-h)');
    const link = css.match(/\.nav-link \{([^}]*)\}/);
    expect(link![1]).toContain('height: var(--nav-item-h)');
  });

  it('does not move the heading itself when its menu opens', () => {
    // The bar held still and the heading rose six pixels inside it. Same
    // twelve-pixel box, different consequence: it sits beside the summary as a
    // flex item, and centring measures itself against the pair rather than
    // against the stated height. Pinned to the top of its box instead.
    const group = css.match(/\.nav-group \{([^}]*)\}/);
    expect(group![1]).toContain('align-items: flex-start');
  });

  it('drops its panel out of the flow, so the page below does not move', () => {
    const panel = css.match(/\.nav-group-items \{([^}]*)\}/);
    expect(panel, 'no .nav-group-items rule').not.toBeNull();
    expect(panel![1]).toContain('position: absolute');
  });

  it('opens one at a time, without a script', () => {
    // name= makes the set exclusive in the browser itself. With scripting off
    // this is the only thing keeping two menus from being open together.
    expect(layoutSource()).toContain('name="topnav"');
  });

  it('closes when the person goes elsewhere', () => {
    // Plain HTML has no way to say "and close when attention moves on", so
    // that part is scripted. Not on mouse-out: a phone has no hover, and a
    // menu that closes when the pointer strays is worse than one that stays.
    expect(script).toContain('details.nav-group[open]');
    expect(script).toContain("'Escape'");
    expect(script).not.toMatch(/mouseout|mouseleave/);
  });

  it('has no menus at all on a phone', () => {
    // A box that scrolls sideways clips what overflows it downwards too, so a
    // menu opened inside the swipeable strip drops behind the bar and cannot
    // be read. The groups open out into the strip instead.
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(phone).toContain('.nav-group { display: contents; }');
    expect(phone).toContain('.nav-group > summary { display: none; }');
  });
});

function layoutSource(): string {
  return readFileSync('src/ui/layout.ts', 'utf8');
}
