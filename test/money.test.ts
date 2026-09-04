import { describe, expect, it } from 'vitest';
import {
  allocateSplit, computeGst, formatBp, parsePercentToBp, roundCents, sumBp,
} from '../src/core/money';

const NZ_GST = 1500; // 15%

describe('computeGst', () => {
  it('adds GST on top of a GST-exclusive amount', () => {
    expect(computeGst(250000, 'exclusive', NZ_GST)).toEqual({ net: 250000, gst: 37500, gross: 287500 });
  });

  it('extracts GST from within a GST-inclusive amount', () => {
    // $2,875.00 inclusive of 15% GST is $2,500.00 + $375.00.
    expect(computeGst(287500, 'inclusive', NZ_GST)).toEqual({ net: 250000, gst: 37500, gross: 287500 });
  });

  it('never loses a cent when extracting GST', () => {
    for (const gross of [1, 7, 99, 100, 12345, 99999, 1_000_001]) {
      const { net, gst, gross: out } = computeGst(gross, 'inclusive', NZ_GST);
      expect(net + gst).toBe(gross);
      expect(out).toBe(gross);
    }
  });

  it('treats zero-rated and exempt amounts as having no GST', () => {
    expect(computeGst(123456, 'none', NZ_GST)).toEqual({ net: 123456, gst: 0, gross: 123456 });
  });

  it('applies no GST when the practice is not registered (rate 0)', () => {
    expect(computeGst(250000, 'exclusive', 0)).toEqual({ net: 250000, gst: 0, gross: 250000 });
  });

  it('rounds half away from zero', () => {
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(1.5)).toBe(2);
    expect(roundCents(-0.5)).toBe(-1);
    // $0.03 + 15% = $0.0345 -> rounds to 0 cents of GST.
    expect(computeGst(3, 'exclusive', NZ_GST).gst).toBe(0);
    // $0.04 + 15% = $0.046 -> rounds to 1 cent.
    expect(computeGst(4, 'exclusive', NZ_GST).gst).toBe(1);
  });
});

describe('allocateSplit', () => {
  const shares = (...bp: number[]) =>
    bp.map((percent_bp, i) => ({ party_key: `p${i}`, label: `P${i}`, percent_bp }));

  it('splits a clean amount 70/30', () => {
    const result = allocateSplit(250000, shares(7000, 3000));
    expect(result.map((r) => r.amount_cents)).toEqual([175000, 75000]);
  });

  it('allocates every cent when the split does not divide evenly', () => {
    // $333.33 three ways.
    const result = allocateSplit(33333, shares(3333, 3333, 3334));
    const total = result.reduce((s, r) => s + r.amount_cents, 0);
    expect(total).toBe(33333);
  });

  it('never loses or invents a cent, across many amounts and splits', () => {
    const splits = [shares(7000, 3000), shares(3333, 3333, 3334), shares(5000, 2500, 1250, 1250), shares(10000)];
    for (const split of splits) {
      for (const base of [1, 3, 7, 99, 101, 1234, 99999, 123456789]) {
        const total = allocateSplit(base, split).reduce((s, r) => s + r.amount_cents, 0);
        expect(total).toBe(base);
      }
    }
  });

  it('gives leftover cents to the largest remainders, deterministically', () => {
    // 1 cent split 70/30: 0.7 and 0.3 -> the 70% party takes the cent.
    expect(allocateSplit(1, shares(7000, 3000)).map((r) => r.amount_cents)).toEqual([1, 0]);
    // 1 cent split 30/70: the 70% party still takes it.
    expect(allocateSplit(1, shares(3000, 7000)).map((r) => r.amount_cents)).toEqual([0, 1]);
  });

  it('allocates only what the percentages claim when they total under 100%', () => {
    const result = allocateSplit(100000, shares(6000, 3000));
    expect(result.map((r) => r.amount_cents)).toEqual([60000, 30000]);
    expect(result.reduce((s, r) => s + r.amount_cents, 0)).toBe(90000);
  });

  it('handles a zero base and an empty share list', () => {
    expect(allocateSplit(0, shares(7000, 3000)).map((r) => r.amount_cents)).toEqual([0, 0]);
    expect(allocateSplit(100000, [])).toEqual([]);
  });

  it('reports percentages back for display', () => {
    expect(allocateSplit(100000, shares(6667, 3333))[0]!.percent).toBeCloseTo(66.67, 2);
  });
});

describe('percentage parsing', () => {
  it('accepts plain, signed and fractional percentages', () => {
    expect(parsePercentToBp('70')).toBe(7000);
    expect(parsePercentToBp('70%')).toBe(7000);
    expect(parsePercentToBp(' 33.33 ')).toBe(3333);
    expect(parsePercentToBp('100')).toBe(10000);
    expect(parsePercentToBp('0')).toBe(0);
  });

  it('rejects anything that is not a percentage in range', () => {
    expect(parsePercentToBp('101')).toBeNull();
    expect(parsePercentToBp('-5')).toBeNull();
    expect(parsePercentToBp('abc')).toBeNull();
    expect(parsePercentToBp('')).toBeNull();
    expect(parsePercentToBp('33.333')).toBeNull();
  });

  it('formats basis points for display', () => {
    expect(formatBp(7000)).toBe('70%');
    expect(formatBp(3333)).toBe('33.33%');
    expect(sumBp([{ percent_bp: 7000 }, { percent_bp: 3000 }])).toBe(10000);
  });
});
