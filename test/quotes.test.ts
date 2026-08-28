import { describe, expect, it } from 'vitest';
import {
  computeLine, formatQuantity, isExpired, parseQuantityToMilli, pluraliseUnit, summariseQuote, validUntil,
} from '../src/core/quotes';

const ex = { gstTreatment: 'exclusive' as const, gstRateBp: 1500 };

describe('a quote line', () => {
  it('multiplies then adds GST once', () => {
    const line = computeLine({ quantityMilli: 3000, unitAmountCents: 25000, ...ex });
    expect(line.lineAmountCents).toBe(75000);
    expect(line.netCents).toBe(75000);
    expect(line.gstCents).toBe(11250);
    expect(line.grossCents).toBe(86250);
  });

  it('handles a fractional quantity exactly', () => {
    const line = computeLine({ quantityMilli: 250, unitAmountCents: 45000, ...ex });
    expect(line.lineAmountCents).toBe(11250);
    expect(line.grossCents).toBe(12938);
  });

  it('rounds the line once rather than per unit', () => {
    // 3 × 33.33 is 99.99, not 3 × 33.33 rounded each time.
    const line = computeLine({ quantityMilli: 3000, unitAmountCents: 3333, gstTreatment: 'none', gstRateBp: 1500 });
    expect(line.lineAmountCents).toBe(9999);
  });

  it('extracts GST from a GST-inclusive unit price', () => {
    const line = computeLine({ quantityMilli: 1000, unitAmountCents: 11500, gstTreatment: 'inclusive', gstRateBp: 1500 });
    expect(line.netCents).toBe(10000);
    expect(line.gstCents).toBe(1500);
    expect(line.grossCents).toBe(11500);
  });

  it('adds no GST when the treatment says none', () => {
    const line = computeLine({ quantityMilli: 2000, unitAmountCents: 75000, gstTreatment: 'none', gstRateBp: 1500 });
    expect(line).toMatchObject({ netCents: 150000, gstCents: 0, grossCents: 150000 });
  });
});

describe('quote totals', () => {
  const lines = [
    { kind: 'professional' as const, lineAmountCents: 250000, netCents: 250000, gstCents: 37500, grossCents: 287500 },
    { kind: 'professional' as const, lineAmountCents: 45000, netCents: 45000, gstCents: 6750, grossCents: 51750 },
    { kind: 'disbursement' as const, lineAmountCents: 75000, netCents: 75000, gstCents: 0, grossCents: 75000 },
    { kind: 'third_party' as const, lineAmountCents: 33000, netCents: 33000, gstCents: 0, grossCents: 33000 },
  ];

  it('keeps fees and money passed through apart, and adds back to the total', () => {
    const t = summariseQuote(lines);
    expect(t.feesNetCents).toBe(295000);
    expect(t.disbursementsNetCents).toBe(108000);
    expect(t.subtotalNetCents).toBe(403000);
    expect(t.gstCents).toBe(44250);
    expect(t.totalCents).toBe(447250);
    expect(t.subtotalNetCents + t.gstCents).toBe(t.totalCents);
  });

  it('reports no GST when nothing carries any, so the quote can omit the line', () => {
    expect(summariseQuote([lines[2]!]).hasGst).toBe(false);
    expect(summariseQuote(lines).hasGst).toBe(true);
    expect(summariseQuote([]).totalCents).toBe(0);
  });
});

describe('how long a quote stands', () => {
  it('counts the day of issue as day one', () => {
    // Issued on the 28th, valid 7 days: good through the 3rd, not the 4th.
    expect(validUntil('2026-08-28', 7)).toBe('2026-09-03');
    expect(validUntil('2026-08-28', 1)).toBe('2026-08-28');
    expect(validUntil('2026-08-28', 14)).toBe('2026-09-10');
  });

  it('crosses a year end and a leap day', () => {
    expect(validUntil('2026-12-30', 7)).toBe('2027-01-05');
    expect(validUntil('2028-02-26', 7)).toBe('2028-03-03');
  });

  it('never produces a date before the day of issue', () => {
    expect(validUntil('2026-08-28', 0)).toBe('2026-08-28');
    expect(validUntil('2026-08-28', -5)).toBe('2026-08-28');
  });

  it('is expired only after the last day has passed', () => {
    expect(isExpired('2026-09-03', '2026-09-03')).toBe(false);
    expect(isExpired('2026-09-03', '2026-09-04')).toBe(true);
    expect(isExpired(null, '2026-09-04')).toBe(false);
  });
});

describe('typed quantities', () => {
  it('accepts whole and fractional amounts, and a comma decimal', () => {
    expect(parseQuantityToMilli('2')).toBe(2000);
    expect(parseQuantityToMilli('1.5')).toBe(1500);
    expect(parseQuantityToMilli('0.25')).toBe(250);
    expect(parseQuantityToMilli('1,5')).toBe(1500);
    expect(parseQuantityToMilli(' 3 ')).toBe(3000);
  });

  it('refuses nonsense rather than guessing', () => {
    for (const junk of ['', '0', '-1', 'two', '1.2345', '1e3', '.']) {
      expect(parseQuantityToMilli(junk), junk).toBeNull();
    }
  });

  it('reads back the way it was typed', () => {
    expect(formatQuantity(1000)).toBe('1');
    expect(formatQuantity(1500)).toBe('1.5');
    expect(formatQuantity(250)).toBe('0.25');
  });
});

describe('units read naturally', () => {
  it('pluralises only when there is more than one', () => {
    expect(pluraliseUnit('hour', 1000)).toBe('hour');
    expect(pluraliseUnit('hour', 2000)).toBe('hours');
    expect(pluraliseUnit('hour', 250)).toBe('hours');
    expect(pluraliseUnit('response', 3000)).toBe('responses');
    expect(pluraliseUnit('copy', 2000)).toBe('copies');
    expect(pluraliseUnit('', 2000)).toBe('');
  });
});
