import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEMES } from '../src/ui/theme';

const css = readFileSync('public/app.css', 'utf8');

/** Relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The declared colours of one theme, from the stylesheet. */
function paletteFor(theme: string): Record<string, string> {
  const pattern = theme === 'slate'
    ? /:root, \[data-theme="slate"\]\s*\{([^}]*)\}/
    : new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`);
  const block = css.match(pattern);
  expect(block, `no palette declared for ${theme}`).not.toBeNull();
  return Object.fromEntries(
    [...block![1]!.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]),
  );
}

/**
 * A theme is now a block of CSS and a line of TypeScript, which makes adding
 * one easy — and makes it just as easy to add one nobody can read. These are
 * the four pairings that decide whether an interface is legible at all.
 */
describe('every theme is readable in both modes', () => {
  for (const theme of THEMES) {
    for (const [mode, p] of [['light', 'l'], ['dark', 'd']] as const) {
      it(`${theme}, ${mode}`, () => {
        const v = paletteFor(theme);
        const pairs: Array<[string, string, string]> = [
          ['body text on the page', v[`${p}-text`]!, v[`${p}-bg`]!],
          ['muted text on the page', v[`${p}-muted`]!, v[`${p}-bg`]!],
          ['body text on a card', v[`${p}-text`]!, v[`${p}-surface`]!],
          ['a link on the page', v[`${p}-accent`]!, v[`${p}-bg`]!],
          ['a button label on its button', v[`${p}-accent-text`]!, v[`${p}-accent`]!],
        ];
        for (const [what, fg, bg] of pairs) {
          const ratio = contrast(fg, bg);
          // WCAG AA for normal text. Muted text and link colours are held to
          // the same bar rather than the 3:1 large-text one, because both are
          // used at ordinary sizes here.
          expect(ratio, `${what} in ${theme} ${mode} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it('keeps the borders visible against their own background', () => {
    for (const theme of THEMES) {
      const v = paletteFor(theme);
      for (const [mode, p] of [['light', 'l'], ['dark', 'd']] as const) {
        const ratio = contrast(v[`${p}-border`]!, v[`${p}-bg`]!);
        // A border only has to be discernible, not readable.
        expect(ratio, `${theme} ${mode} border`).toBeGreaterThan(1.1);
      }
    }
  });
});
