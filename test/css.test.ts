import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('public/app.css', 'utf8');

/**
 * Layout rules that were got wrong once and would be easy to get wrong again.
 * These do not test appearance — they test the specific decisions that stopped
 * the interface breaking on a phone.
 */
describe('the figures strip survives a narrow screen', () => {
  const block = css.match(/\.fee-summary \{([^}]*)\}/);

  it('lays out as a grid, not a flex row', () => {
    // Flex plus a min-width lets six boxes fight over 390 pixels until each is
    // a couple of characters wide and the labels wrap one letter per line.
    expect(block).not.toBeNull();
    expect(block![1]).toContain('grid');
    expect(block![1]).not.toContain('display: flex');
  });

  it('drops to two columns on a phone', () => {
    expect(css).toContain('.fee-summary { grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('exempts labels and figures from the page-wide word breaking', () => {
    for (const selector of ['.stat-label', '.stat-value', '.num']) {
      const rule = css.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
      expect(rule, `no rule for ${selector}`).not.toBeNull();
      expect(rule![1], `${selector} must opt out of word breaking`).toContain('word-break: normal');
    }
  });
});

describe('nothing but tables and the nav may scroll sideways', () => {
  it('keeps long words from pushing the page wide', () => {
    expect(css).toContain('overflow-wrap: break-word');
    expect(css).toContain('html { overflow-x: hidden; }');
  });

  it('gives tables their own scrolling box', () => {
    expect(css).toContain('.table-wrap { overflow-x: auto');
  });

  it('makes form controls 16px on a phone, so iOS does not zoom the page', () => {
    expect(css).toMatch(/input, select, textarea \{ font-size: 16px/);
  });
});
