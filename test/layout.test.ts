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
