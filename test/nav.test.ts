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
import { readdirSync, readFileSync } from 'node:fs';
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
    // Twelve wrapped onto a second line at the width the practice works at, and
    // eight was the ceiling it was brought under — a round number chosen well
    // clear of the fault rather than measured.
    //
    // Raised to nine on 3 September, when the calendar needed a place and the
    // alternative was demoting a page the register's own rule (below) keeps one
    // glance away. Measured in Chromium first, rather than assumed: the
    // nine-item bar holds a single line at every width from 780px — where the
    // mobile nav takes over — to 1680px. The next addition measures again; the
    // ceiling is evidence, not an allowance.
    expect(entries.length).toBeLessThanOrEqual(9);
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

  it('keeps its menus on a phone, and opens them into the bar', () => {
    // This used to say the opposite, and said it about an arrangement that did
    // not work. On a phone the bar was one sideways-scrolling strip and the
    // groups were flattened into it with `display: contents` — but a browser
    // draws nothing inside a *closed* <details> whatever its display is, so
    // Quotes, Invoices, Knowledge and the Assistant were not rendered at all.
    // The test passed because it checked the CSS said what it was written to
    // say. Reported by the practice on 4 September 2026: "Where are the
    // invoices and quotes? Cannot see them on my phone."
    //
    // What is pinned now is the property: nothing in the bar is hidden by CSS,
    // and the panel is in the flow rather than floating (there is no
    // positioning context on a phone worth floating against).
    const phone = phoneBlocks();
    expect(phone.length, 'no phone block in the stylesheet').toBeGreaterThan(0);
    const all = phone.join('\n');
    expect(all, 'a closed <details> renders nothing, display: contents or not')
      .not.toContain('.nav-group { display: contents; }');
    expect(all, 'the menu heading is the only way in on a phone')
      .not.toMatch(/\.nav-group > summary \{[^}]*display:\s*none/);
    expect(all).toMatch(/\.nav-group-items \{[^}]*position:\s*static/);
  });

  it('never lets the bar scroll sideways on a phone', () => {
    // The strip carried no scrollbar (by design) and no fading edge, so the
    // run simply stopped after Cases with nothing to say six more sections
    // were past the right-hand edge. It wraps instead.
    const all = phoneBlocks().join('\n');
    const topnav = all.match(/\.topnav \{([^}]*)\}/);
    expect(topnav, 'no .topnav rule in the phone block').not.toBeNull();
    expect(topnav![1]).toContain('flex-wrap: wrap');
    expect(topnav![1]).not.toContain('overflow-x');
  });

  /**
   * How far down the page the bar reaches.
   *
   * `--topbar-h` is a stated number about a measured thing: sticky table
   * headings and the toasts hang off it. It had gone stale at every one of its
   * breakpoints by 4 September 2026, because the bar gained a row twice and
   * nobody re-measured — a sticky heading on a phone was sitting 27px behind
   * the bar.
   *
   * The figures themselves can only be checked in a browser. What can be
   * checked here is the shape they must have: a bar that wraps can only get
   * taller as the screen narrows, so the value must never fall as the
   * breakpoint does. A careless edit shows up as a fall.
   */
  it('states a bar height that only grows as the screen narrows', () => {
    const base = css.match(/--topbar-h:\s*(\d+)px/);
    expect(base, 'no --topbar-h').not.toBeNull();
    const steps = [...css.matchAll(
      /@media \(max-width: (\d+)px\) \{ :root \{ --topbar-h: (\d+)px; \} \}/g,
    )].map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
    expect(steps.length, 'the bar wraps at more widths than this').toBeGreaterThanOrEqual(4);
    let previous = Number(base![1]);
    for (const step of [...steps].sort((a, b) => b.width - a.width)) {
      expect(step.height, `--topbar-h falls at ${step.width}px`).toBeGreaterThanOrEqual(previous);
      previous = step.height;
    }
  });
});

/**
 * A page says which section it is in, and it says its own.
 *
 * The Invoices list and every single invoice marked *Quotes* as the current
 * section — left over from when invoices were reached only through a quote.
 * On a wide screen it was a wrong highlight inside an open menu; on a phone,
 * where the menu opens into the bar, it put the blue on the wrong word right
 * next to the right one.
 */
describe('the section a page says it is in', () => {
  const modules = readdirSync('src/modules');

  it('is one of that module\'s own', () => {
    let checked = 0;
    for (const name of modules) {
      const src = readFileSync(`src/modules/${name}/index.ts`, 'utf8');
      const hrefs = [...src.matchAll(/nav: \[\{ href: '([^']+)'/g)].map((m) => m[1]);
      // A module with no entry of its own borrows the section it lives under —
      // the Inbox is part of Incoming, workflows are reached from Alerts.
      if (hrefs.length === 0) continue;
      const actives = new Set([...src.matchAll(/active: '([^']+)'/g)].map((m) => m[1]));
      for (const active of actives) {
        expect(hrefs, `${name} marks ${active} as the current section`).toContain(active);
        checked += 1;
      }
    }
    // Without this the loop above passes by finding nothing.
    expect(checked, 'no module declared both a nav entry and an active section')
      .toBeGreaterThan(8);
  });
});

/** Every `@media (max-width: 720px)` block, in source order. */
function phoneBlocks(): string[] {
  const css = readFileSync('public/app.css', 'utf8');
  return css.split('@media (max-width: 720px)').slice(1).map((b) => b.split('@media')[0]!);
}

function layoutSource(): string {
  return readFileSync('src/ui/layout.ts', 'utf8');
}
