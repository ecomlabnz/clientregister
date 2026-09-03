import { describe, expect, it } from 'vitest';
import {
  daysInMonth, firstDay, lastDay, leadingBlanks, monthGrid, monthKeyOf,
  monthName, shiftMonth, validMonth, WEEKDAYS,
} from '../src/core/months';

/**
 * The awkward cases, tested directly.
 *
 * An off-by-one in a calendar grid loses a day off the bottom of the page, and
 * the day it loses is the 31st — the one nobody notices missing until a
 * deadline on it goes past.
 */

describe('the length of a month', () => {
  it('knows the ordinary ones', () => {
    expect(daysInMonth('2026-09')).toBe(30);
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('2026-02')).toBe(28);
  });

  it('knows a leap year, and the century rule', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2000-02')).toBe(29);  // divisible by 400: a leap year
    expect(daysInMonth('1900-02')).toBe(28);  // divisible by 100 but not 400
    expect(daysInMonth('2100-02')).toBe(28);
  });

  it('gives the first and last day as real dates', () => {
    expect(firstDay('2026-09')).toBe('2026-09-01');
    expect(lastDay('2026-09')).toBe('2026-09-30');
    expect(lastDay('2024-02')).toBe('2024-02-29');
    expect(lastDay('2026-12')).toBe('2026-12-31');
  });
});

describe('moving between months', () => {
  it('rolls the year in both directions', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('moves by more than a year', () => {
    expect(shiftMonth('2026-09', 12)).toBe('2027-09');
    expect(shiftMonth('2026-09', -12)).toBe('2025-09');
    expect(shiftMonth('2026-09', 5)).toBe('2027-02');
    expect(shiftMonth('2026-03', -5)).toBe('2025-10');
  });

  it('comes back to where it started', () => {
    for (const key of ['2026-01', '2026-06', '2026-12', '2024-02']) {
      for (const by of [1, 3, 12, 25]) {
        expect(shiftMonth(shiftMonth(key, by), -by), `${key} ± ${by}`).toBe(key);
      }
    }
  });

  it('always produces a two-digit month', () => {
    // "2027-1" would not sort, and would not match the query pattern either.
    for (let i = -30; i <= 30; i++) {
      expect(shiftMonth('2026-06', i)).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
    }
  });
});

describe('the month a query asked for', () => {
  it('takes a well-formed one', () => {
    expect(validMonth('2026-09', '2026-01')).toBe('2026-09');
    expect(validMonth('2024-02', '2026-01')).toBe('2024-02');
  });

  it('refuses nonsense rather than rendering a broken grid', () => {
    for (const bad of ['', undefined, 'yesterday', '2026-13', '2026-00', '2026-9',
                       '26-09', '2026-09-01', "2026-09' OR 1=1", '../2026-09']) {
      expect(validMonth(bad as never, '2026-01'), `${bad} is not a month`).toBe('2026-01');
    }
  });

  it('will not walk to a year nothing can be in', () => {
    // Without this the month links are an infinite corridor.
    expect(validMonth('1799-06', '2026-01')).toBe('2026-01');
    expect(validMonth('2201-06', '2026-01')).toBe('2026-01');
    expect(validMonth('1900-01', '2026-01')).toBe('1900-01');
  });

  it('reads the month off a date', () => {
    expect(monthKeyOf('2026-09-14')).toBe('2026-09');
  });
});

describe('the grid', () => {
  it('runs Monday to Sunday, as a New Zealand calendar does', () => {
    expect(WEEKDAYS[0]).toBe('Mon');
    expect(WEEKDAYS[6]).toBe('Sun');
    expect(WEEKDAYS.length).toBe(7);
  });

  it('gives a month starting on Sunday six leading blanks, not none', () => {
    // getUTCDay() counts from Sunday, so this is the case a naive
    // implementation gets exactly wrong.
    expect(new Date('2026-11-01T00:00:00Z').getUTCDay()).toBe(0); // a Sunday
    expect(leadingBlanks('2026-11')).toBe(6);
  });

  it('gives a month starting on Monday no leading blanks', () => {
    expect(new Date('2026-06-01T00:00:00Z').getUTCDay()).toBe(1);
    expect(leadingBlanks('2026-06')).toBe(0);
  });

  it('contains every day of the month exactly once', () => {
    // The assertion that matters: a day dropped here is a deadline nobody sees.
    for (const key of ['2026-09', '2026-11', '2024-02', '2026-02', '2026-12',
                       '2026-01', '2000-02', '1900-02']) {
      const days = monthGrid(key).flat().filter((d): d is string => d !== null);
      expect(days.length, `${key} has the wrong number of days`).toBe(daysInMonth(key));
      expect(new Set(days).size, `${key} repeats a day`).toBe(days.length);
      expect(days[0]).toBe(firstDay(key));
      expect(days[days.length - 1]).toBe(lastDay(key));
    }
  });

  it('is always whole weeks, so no row is ragged', () => {
    for (const key of ['2026-09', '2026-11', '2024-02', '2026-02', '2026-08']) {
      const grid = monthGrid(key);
      for (const week of grid) expect(week.length).toBe(7);
      expect(grid.length).toBeGreaterThanOrEqual(4);
      expect(grid.length).toBeLessThanOrEqual(6);
    }
  });

  it('puts each day under the right weekday column', () => {
    // February 2026 starts on a Sunday, so the 1st belongs in the last column.
    const grid = monthGrid('2026-02');
    expect(grid[0]![6]).toBe('2026-02-01');
    for (const week of grid) {
      week.forEach((day, column) => {
        if (!day) return;
        const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
        expect(weekday, `${day} is in the wrong column`).toBe(column);
      });
    }
  });

  it('needs six rows for a 31-day month starting on a Saturday', () => {
    // The longest possible grid. A five-row assumption loses the last days.
    expect(new Date('2026-08-01T00:00:00Z').getUTCDay()).toBe(6);
    const grid = monthGrid('2026-08');
    expect(grid.length).toBe(6);
    expect(grid.flat().filter(Boolean)).toHaveLength(31);
  });
});

describe('the heading', () => {
  it('names the month and the year in full', () => {
    expect(monthName('2026-09')).toMatch(/September/);
    expect(monthName('2026-09')).toMatch(/2026/);
  });

  it('does not slip a day either side of midnight', () => {
    // Built in UTC on purpose: local-time arithmetic renders the 1st of a
    // month as the last day of the previous one for somebody in Auckland.
    expect(monthName('2026-01')).toMatch(/January 2026/);
    expect(monthName('2026-12')).toMatch(/December 2026/);
  });
});

describe('weeks', () => {
  it('starts a week on Monday', async () => {
    const { weekStart } = await import('../src/core/months');
    // 2026-09-03 is a Thursday.
    expect(new Date('2026-09-03T00:00:00Z').getUTCDay()).toBe(4);
    expect(weekStart('2026-09-03')).toBe('2026-08-31');
  });

  it('puts a Sunday in the week that started six days earlier', async () => {
    // The case a naive implementation gets wrong — and it gets it wrong for
    // exactly one day in seven, which is how it survives a casual check.
    const { weekStart } = await import('../src/core/months');
    expect(new Date('2026-09-06T00:00:00Z').getUTCDay()).toBe(0);
    expect(weekStart('2026-09-06')).toBe('2026-08-31');
    expect(weekStart('2026-09-07')).toBe('2026-09-07'); // the Monday after
  });

  it('leaves a Monday where it is', async () => {
    const { weekStart } = await import('../src/core/months');
    expect(weekStart('2026-08-31')).toBe('2026-08-31');
  });

  it('gives seven consecutive days, Monday to Sunday', async () => {
    const { weekDays } = await import('../src/core/months');
    const days = weekDays('2026-09-03');
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-08-31');
    expect(days[6]).toBe('2026-09-06');
    days.forEach((d, i) => {
      expect((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7).toBe(i);
    });
  });

  it('crosses a month and a year boundary without a gap', async () => {
    const { weekDays } = await import('../src/core/months');
    for (const date of ['2026-12-31', '2027-01-01', '2024-02-29']) {
      const days = weekDays(date);
      expect(days).toHaveLength(7);
      expect(new Set(days).size).toBe(7);
      expect(days).toContain(date);
      // Consecutive: each is one day after the last.
      for (let i = 1; i < 7; i++) {
        const gap = (Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i-1]}T00:00:00Z`)) / 86_400_000;
        expect(gap).toBe(1);
      }
    }
  });

  it('moves by days across boundaries', async () => {
    const { shiftDate } = await import('../src/core/months');
    expect(shiftDate('2026-08-31', 7)).toBe('2026-09-07');
    expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
    expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('names a week, and says both months when it spans two', async () => {
    const { weekName } = await import('../src/core/months');
    expect(weekName('2026-09-10')).toMatch(/7–13 September 2026/);
    expect(weekName('2026-09-03')).toMatch(/31 August – 6 September 2026/);
    expect(weekName('2026-12-31')).toMatch(/2026.*2027/);
  });

  it('refuses a day that is not a day', async () => {
    const { validDate } = await import('../src/core/months');
    expect(validDate('2026-09-03')).toBe('2026-09-03');
    // The shape is not enough: this matches the pattern and is not a date.
    for (const bad of ['2026-02-30', '2026-13-01', '2026-09-32', 'today', '', undefined, '26-09-03']) {
      expect(validDate(bad as never), `${bad}`).toBeNull();
    }
  });
});

describe('years', () => {
  it('gives twelve months, January first', async () => {
    const { yearMonths } = await import('../src/core/months');
    const months = yearMonths(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-01');
    expect(months[11]).toBe('2026-12');
  });

  it('refuses a year nothing can be in', async () => {
    const { validYear } = await import('../src/core/months');
    expect(validYear('2026', 2000)).toBe(2026);
    for (const bad of ['1899', '2201', '26', 'nineteen', '', undefined]) {
      expect(validYear(bad as never, 2000), `${bad}`).toBe(2000);
    }
  });
});
