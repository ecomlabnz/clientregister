import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('public/app.css', 'utf8');

/**
 * Two mistakes made the client form unreadable, and neither showed up in the
 * checks that existed — those only asked whether anything ran off the edge of
 * the screen, and nothing did. A form can be entirely inside the viewport and
 * still be three 87px columns of wrapped labels. These guard the fixes.
 */
describe('form layout', () => {
  /** Every declaration block, with the at-rules it sits inside. */
  function rules(source: string) {
    const out: { at: string[]; selector: string; body: string }[] = [];
    const at: string[] = [];
    let buf = '';
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '{') {
        const head = buf.trim();
        buf = '';
        if (head.startsWith('@')) { at.push(head); continue; }
        let depth = 1;
        let body = '';
        while (++i < source.length && depth > 0) {
          if (source[i] === '{') depth++;
          else if (source[i] === '}') { depth--; if (!depth) break; }
          body += source[i];
        }
        out.push({ at: [...at], selector: head, body });
      } else if (ch === '}') {
        at.pop();
        buf = '';
      } else {
        buf += ch;
      }
    }
    return out;
  }

  const columnRules = rules(css).filter((r) =>
    /\.form-grid|\.form-section|\.settings-form|\[data-panel\]|\[data-kind\]/.test(r.selector)
    && /grid-template-columns/.test(r.body));

  it('sizes forms off their container, never off the window', () => {
    // A form in the narrow column of a two-column page is 430px wide on a
    // 1400px screen. A viewport media query cannot know that; a container
    // query is the only thing that can.
    expect(columnRules.length).toBeGreaterThan(0);
    for (const rule of columnRules) {
      const media = rule.at.filter((a) => a.startsWith('@media'));
      expect(media, `viewport breakpoint on ${rule.selector}`).toEqual([]);
    }
    expect(css).toMatch(/@container \(min-width: \d+px\)/);
  });

  it('gives the boxes that hold forms a container to measure', () => {
    for (const holder of ['.main', '.card-body', '.cols > *', '.form-section']) {
      const decl = css.split('\n').find((l) => l.trimStart().startsWith(holder + ' ')
        || l.trimStart().startsWith(holder + '{'));
      expect(decl, `${holder} must carry container-type`).toBeTruthy();
    }
    // An element is never sized by its own container query, so the form
    // itself must not be the container — that would leave it stuck at one
    // column forever.
    const formGrid = css.slice(css.indexOf('.form-grid {'), css.indexOf('.form-grid {') + 200);
    expect(formGrid).not.toMatch(/container-type/);
  });

  it('never places an item at 1 / -1 inside auto-fit tracks', () => {
    // `grid-column: 1 / -1` resolves the auto-repetition to a single track, so
    // "take the whole form" silently means "take one column". The section
    // marked widest on the client form was rendering as the narrowest.
    for (const rule of columnRules) {
      expect(rule.body, `auto-fit on ${rule.selector}, whose children span 1 / -1`)
        .not.toMatch(/repeat\(auto-fit/);
    }
  });

  it('lets one set of breakpoints govern panels and sections alike', () => {
    // `.js-tabbed [data-panel]` is the more specific selector, so when it
    // carried its own track list it overrode the shared one and a panel came
    // out four columns wide while a plain section came out three.
    const tabbed = css.slice(css.indexOf('.js-tabbed [data-panel]:not([hidden])'));
    const ownTracks = tabbed.split('\n')
      .filter((l) => l.includes('[data-panel]') && l.includes('grid-template-columns'));
    expect(ownTracks, 'panels must take their columns from the shared rules').toEqual([]);
  });
});

describe('pages in one family look like one family', () => {
  const modules = ['src/modules/alerts/index.ts', 'src/modules/workflows/index.ts'];

  it('never shows the alerts bar without the figures above it', () => {
    // "For approval" is a tab of Alerts, so it wears the Alerts furniture. It
    // wore the bar but not the three figures, and a counter strip that
    // disappears on a click reads as something having broken rather than as
    // something having moved.
    for (const file of modules) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('alertTabs({')) continue;
      expect(text, `${file} renders the alerts bar without alertCounters`)
        .toContain('alertCounters(');
    }
  });

  it('builds both from the same list, so they cannot disagree', () => {
    // Counted from what the page actually holds rather than from a second
    // query that might not agree with it.
    for (const file of modules) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes('alertTabs({')) continue;
      expect(text).toMatch(/alertCounters\(alerts\)/);
      expect(text).toMatch(/alertTabs\(\{ alerts,/);
    }
  });
});

describe('one menu entry for the incoming family', () => {
  const inbox = readFileSync('src/modules/inbox/index.ts', 'utf8');
  const inquiries = readFileSync('src/modules/inquiries/index.ts', 'utf8');

  it('declares the entry once, not once per surface', () => {
    // Inbox, Inquiries and Conversations are three surfaces of "what came in".
    // Three menu entries made you choose a screen before you knew what had
    // arrived; the bar between them does that job now.
    expect(inbox).toContain('nav: [],');
    expect(inquiries).toMatch(/nav: \[\{ href: '\/inquiries', label: 'Incoming'/);
  });

  it('highlights that entry from every page in the family', () => {
    // `active` is matched against the entry's href, so a page setting anything
    // else leaves the menu with nothing lit while you are standing on it.
    expect(inbox, 'an inbox page still claims a menu entry of its own')
      .not.toContain("active: '/inbox'");
    for (const page of inbox.matchAll(/active: '([^']+)'/g)) {
      expect(page[1]).toBe('/inquiries');
    }
  });

  it('hides triage tabs from a role that cannot triage', () => {
    // A tab that refuses to open is worse than one that was never offered.
    expect(inquiries).toContain("const triage = can(user, 'ingest:triage');");
    expect(inquiries).toMatch(/show: triage[\s\S]{0,200}filter\(\(t\) => t\.show\)/);
  });

  it('counts what is waiting, not how many rows exist', () => {
    // A number beside a tab is only useful if it means "this much is asking
    // for you". Every inquiry ever received is not that.
    expect(inquiries).toContain("WHERE status IN ('new', 'triaged', 'responded', 'quoted')");
    expect(inquiries).toContain("FROM ingest_messages WHERE status = 'pending'");
  });
});

describe('a control that needs scripting is not shown without it', () => {
  const clients = readFileSync('src/modules/clients/index.ts', 'utf8');
  const appjs = readFileSync('public/app.js', 'utf8');

  it('keeps the tab bar hidden until the script that drives it runs', () => {
    // The two directions are opposites and were confused once. `js-hide` marks
    // a control that exists *for* the no-script case and is taken away when
    // scripting turns up — a fallback submit button beside an auto-submitting
    // select. A tab bar is the other way round: useless without scripting, so
    // it ships hidden and the script reveals it.
    //
    // Marked `js-hide`, the bar was hidden early and then un-hidden by the tab
    // code's own `bar.hidden = false`, which meant it showed in both cases —
    // five buttons that did nothing with scripting off.
    expect(clients).toMatch(/<nav class="tabs form-tabs"[^>]*\bhidden>/);
    expect(clients, 'the tab bar must not use the fallback marker')
      .not.toMatch(/form-tabs[^>]*js-hide/);
    expect(appjs, 'something has to reveal it').toContain('bar.hidden = false;');
  });

  it('leaves every panel readable when the bar is gone', () => {
    // With no script the form is one long page rather than five unreachable
    // ones. Panels are hidden by the script, never by the server.
    expect(appjs).toContain("panel.hidden = panel.getAttribute('data-panel') !== current");
    // Whole opening tags: `data-kind` is written before `data-panel`, so a
    // pattern anchored on the latter never sees it.
    const panelMarkup = [...clients.matchAll(/<div [^>]*data-panel="[a-z]+"[^>]*>/g)].map((m) => m[0]);
    expect(panelMarkup.length).toBeGreaterThan(3);
    for (const tag of panelMarkup) {
      // `data-kind` sections carry a server-side hidden on purpose: company
      // boxes never belong on an individual, script or no script.
      if (tag.includes('data-kind')) continue;
      expect(tag, `a panel ships hidden and nothing would reveal it: ${tag}`)
        .not.toMatch(/\bhidden\b/);
    }
  });
});

/**
 * The navigation carries twelve sections. At full spacing they need about
 * 970px, which is more than the top bar can spare beside the wordmark and the
 * search box on anything but a wide screen — so it used to wrap into a ragged
 * second row with a hole in the middle of the first.
 *
 * Two rules fix it, and both have to stay: the links tighten with the viewport
 * instead of jumping a row, and below the width where the set can share a line
 * it takes a full-width line of its own.
 */
describe('the navigation fits the width it is given', () => {
  const css = readFileSync('public/app.css', 'utf8');

  it('tightens the links with the viewport rather than at a breakpoint', () => {
    // clamp() and not a media query, because the width at which twelve links
    // stop fitting depends on their labels, and those are configuration.
    expect(css).toMatch(/\.nav-link\s*\{[^}]*padding:\s*4px clamp\(/);
    expect(css).toMatch(/\.topnav\s*\{[^}]*gap:\s*clamp\(/);
  });

  it('gives the navigation its own row before it would wrap raggedly', () => {
    const block = css.slice(css.indexOf('@media (max-width: 1520px)'));
    expect(block.slice(0, 400)).toContain('.topnav { order: 3; width: 100%; flex: none; }');
  });

  it('still becomes one swipeable strip on a phone', () => {
    // The full-width row above must not have replaced this: on a phone the set
    // is wider than the screen however tight the spacing, and a strip you can
    // flick beats four stacked rows of chrome above every page.
    // There is more than one phone block, so look at all of them rather than
    // whichever happens to come first.
    const blocks = css.split('@media (max-width: 720px)').slice(1)
      .map((b) => b.split('@media')[0]!);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((b) => b.includes('flex-wrap: nowrap') && b.includes('overflow-x: auto')))
      .toBe(true);
  });
});
