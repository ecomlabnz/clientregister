/**
 * An empty amount box is not nil.
 *
 * **Reported on 11 September 2026:** *"i am trying to adjust the bottom to make
 * it match but it does not let me."* A schedule stood at $11,382.70 against a
 * quotation of $3,959.40 — the fee lines had been lowered underneath it — and
 * every attempt to bring it down was refused.
 *
 * The cause: an empty amount box read as unparseable, and an unparseable stage
 * was written back **exactly as it was**. So a box cleared to nothing quietly
 * got its old figure back, and that figure still counted towards the total. The
 * practice was told their schedule came to more than the quotation, with no
 * hint that the boxes they had emptied had been refilled behind them — and the
 * "saved, except N stages" line that would have said so sat *after* the budget
 * refusal and never ran.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/modules/quotes/index.ts', 'utf8');

/** The parser as the route uses it. */
function parseMoneyToCents(input: string): number | null {
  const clean = input.trim().replace(/[$,\s]/g, '').replace(',', '.');
  if (!/^-?\d{0,9}(\.\d{1,2})?$/.test(clean) || clean === '' || clean === '.') return null;
  const value = Math.round(Number(clean) * 100);
  return Number.isFinite(value) ? value : null;
}

describe('the parser that started it', () => {
  it('reads an empty box as nothing it can use, not as zero', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('   ')).toBeNull();
  });

  it('reads a typed zero as zero', () => {
    // Which is why the refusal tells the practice to type one.
    expect(parseMoneyToCents('0')).toBe(0);
    expect(parseMoneyToCents('0.00')).toBe(0);
  });
});

describe('an unreadable amount refuses the whole save', () => {
  it('is checked before the total, not after it', () => {
    // A total that includes a figure nobody typed is not a total worth
    // arguing about. The old order is what hid the fault for two days.
    const save = src.slice(src.indexOf("if (form.get('_action') === 'save')"));
    const problemCheck = save.indexOf('if (problems.length) {');
    const budgetCheck = save.indexOf('if (intended > budget) {');
    expect(problemCheck).toBeGreaterThan(-1);
    expect(budgetCheck).toBeGreaterThan(-1);
    expect(problemCheck, 'the unreadable-amount refusal must come first').toBeLessThan(budgetCheck);
  });

  it('names the stage and says what to type instead', () => {
    expect(src).toContain('has no amount the register can read, so nothing was saved.');
    expect(src).toContain('An empty box is not nil');
    expect(src).toContain('type 0 to set a stage to nothing.');
  });

  it('no longer writes a stage back at its old figure', () => {
    // The silent restore. Its absence is the fix.
    expect(src).not.toContain(
      'Unreadable: this stage is written back exactly as it was');
    expect(src).toContain(
      "if (p.keepAsIs) throw new Error('a stage with an unreadable amount reached the write');");
  });

  it('no longer half-saves and mentions it afterwards', () => {
    expect(src).not.toContain('Saved, except ${problems.length} stage(s)');
  });
});
