/**
 * A reader chooses their own typeface, from the faces their device already has.
 *
 * **Asked for on 12 September 2026**, after a nine-column education history
 * would not fit: *"the body-font change - please build it, with 3-4 options of
 * various narrow font types if available so the user can select."*
 *
 * ## What is pinned, and what deliberately is not
 *
 * The rule: a choice puts an attribute on the root element, that attribute
 * redefines one variable, and everything reads through that variable. Nothing
 * here asserts a width in pixels, because the answer depends on which faces the
 * reader's machine happens to have — and that is a property of their laptop,
 * not of this register.
 *
 * **Every stack must end in a face that always exists.** A reader with none of
 * the named faces has to land somewhere sensible, and "somewhere sensible" is
 * what they already see today. That is the one thing here worth a test: the
 * failure it prevents is invisible on the machine of whoever wrote the stack.
 *
 * Measured in Chromium while this was built, and recorded because it is the
 * sort of thing a later reader will wonder about: on the build machine all
 * three sans options rendered identically, because it has none of Arial
 * Narrow, Liberation Sans Narrow, DejaVu Sans Condensed or Roboto Condensed
 * installed. That is the fallback working, not the feature failing — and it is
 * exactly why this file measures nothing.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FONTS, FONT_INFO, fontOf, isFont } from '../src/ui/theme';

const css = readFileSync('public/app.css', 'utf8');

describe('the choices on offer', () => {
  it('names four, each with a name and a description', () => {
    expect(FONTS.length).toBe(4);
    for (const id of FONTS) {
      expect(FONT_INFO[id].name, id).toBeTruthy();
      expect(FONT_INFO[id].description, id).toBeTruthy();
    }
  });

  it('falls back to the system face for anything it does not know', () => {
    // A value that reached the users table unrecognised would otherwise be
    // rendered as an attribute on every page.
    expect(fontOf({ font: 'narrow' })).toBe('narrow');
    expect(fontOf({ font: 'comic-sans' })).toBe('system');
    expect(fontOf({ font: null })).toBe('system');
    expect(fontOf(null)).toBe('system');
    expect(isFont('narrow')).toBe(true);
    expect(isFont('spaghetti')).toBe(false);
  });
});

describe('the stylesheet behind the choices', () => {
  /** The `--font` declaration under `:root[data-font="…"]`, if there is one. */
  function stackFor(id: string): string | null {
    const m = css.match(new RegExp(`:root\\[data-font="${id}"\\]\\s*\\{([\\s\\S]*?)\\}`));
    if (!m) return null;
    return m[1]!.match(/--font:([\s\S]*?);/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  }

  it('redefines the face for every choice but the default', () => {
    // `system` deliberately has no block: it is what `:root` already says.
    expect(stackFor('system')).toBeNull();
    for (const id of FONTS.filter((f) => f !== 'system')) {
      expect(stackFor(id), id).toBeTruthy();
    }
  });

  it('ends every stack in a face that always exists', () => {
    // The failure this prevents is invisible to whoever wrote the stack: their
    // machine has the fancy face, so they never see the reader who does not.
    for (const id of FONTS.filter((f) => f !== 'system')) {
      const stack = stackFor(id)!;
      expect(stack, id).toMatch(/(sans-serif|serif)$/);
    }
  });

  it('changes only the face, never a size', () => {
    // A typeface choice that also changed sizes would be a second, hidden
    // scale setting — and the practice was told plainly that a scale is a
    // separate and much larger change.
    for (const id of FONTS.filter((f) => f !== 'system')) {
      const block = css.match(new RegExp(`:root\\[data-font="${id}"\\]\\s*\\{([\\s\\S]*?)\\}`))![1]!;
      expect(block, id).not.toMatch(/font-size|line-height|padding|margin/);
    }
  });

  it('shows a sample in the face it names, so the choice is made by looking', () => {
    for (const id of FONTS.filter((f) => f !== 'system')) {
      expect(css, id).toContain(`.font-sample[data-font="${id}"]`);
    }
  });

  it('downloads nothing', () => {
    // The content policy is `default-src 'none'` with no `font-src`. A webfont
    // would be blocked, silently, and the page would render in the fallback —
    // so this must never quietly acquire one.
    expect(css).not.toMatch(/@font-face|fonts\.googleapis|fonts\.gstatic|url\(\s*['"]?https?:/);
  });
});
