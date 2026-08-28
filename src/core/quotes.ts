/**
 * Quote arithmetic.
 *
 * Everything is integer cents and integer thousandths, and every function here
 * is pure, because this is the part of the system a client checks with a
 * calculator. If it is a cent out, the practice looks careless.
 *
 * A line is a quantity of something at a unit price. The quantity is held in
 * thousandths so that a quarter of an hour is exactly 250 rather than a float
 * that multiplies into a rounding error.
 */

import { computeGst, roundCents, type GstTreatment, type FeeKind } from './fees';

export interface QuoteLineInput {
  description: string;
  kind: FeeKind;
  unitLabel: string;
  quantityMilli: number;
  unitAmountCents: number;
  gstTreatment: GstTreatment;
  gstRateBp: number;
}

export interface QuoteLineAmounts {
  /** Quantity × unit price, as typed, before GST is separated out. */
  lineAmountCents: number;
  netCents: number;
  gstCents: number;
  grossCents: number;
}

/**
 * One line's figures.
 *
 * The quantity is applied first and rounded once, then GST is separated from
 * that single figure. Doing it the other way — GST per unit, then multiplied —
 * multiplies the rounding error by the quantity.
 */
export function computeLine(line: Pick<QuoteLineInput,
  'quantityMilli' | 'unitAmountCents' | 'gstTreatment' | 'gstRateBp'>): QuoteLineAmounts {
  const lineAmountCents = roundCents((line.unitAmountCents * line.quantityMilli) / 1000);
  const gst = computeGst(lineAmountCents, line.gstTreatment, line.gstRateBp);
  return { lineAmountCents, netCents: gst.net, gstCents: gst.gst, grossCents: gst.gross };
}

export interface QuoteLine extends QuoteLineAmounts {
  kind: FeeKind;
}

export interface QuoteTotals {
  /** Professional fees, before GST. */
  feesNetCents: number;
  /** Money paid on the client's behalf, before GST. */
  disbursementsNetCents: number;
  /** Everything, before GST — what a client reads as "subtotal". */
  subtotalNetCents: number;
  gstCents: number;
  totalCents: number;
  /** True when any line actually carries GST, which decides whether the
   *  quote shows a GST line at all. */
  hasGst: boolean;
}

export function summariseQuote(lines: QuoteLine[]): QuoteTotals {
  let feesNetCents = 0;
  let disbursementsNetCents = 0;
  let gstCents = 0;
  let totalCents = 0;

  for (const line of lines) {
    if (line.kind === 'professional') feesNetCents += line.netCents;
    else disbursementsNetCents += line.netCents;
    gstCents += line.gstCents;
    totalCents += line.grossCents;
  }

  return {
    feesNetCents,
    disbursementsNetCents,
    subtotalNetCents: feesNetCents + disbursementsNetCents,
    gstCents,
    totalCents,
    hasGst: gstCents !== 0,
  };
}

/**
 * The last day a quote stands.
 *
 * Counted **inclusive of the day of issue**, which is how a person reads "valid
 * for 7 days": issued on the 28th, it is good through the 3rd, not the 4th.
 *
 * A quote should never say "7 days" — by the time it is read, the reader has to
 * work out when it was written and do the arithmetic themselves, and they will
 * do it differently from you. It says a date.
 */
export function validUntil(issuedOn: string, days: number): string {
  const span = Math.max(1, Math.floor(days));
  const at = new Date(`${issuedOn.slice(0, 10)}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + span - 1);
  return at.toISOString().slice(0, 10);
}

/** Whether a quote has passed its last day, as at `today`. */
export function isExpired(validUntilDate: string | null, today: string): boolean {
  return Boolean(validUntilDate) && validUntilDate! < today;
}

/**
 * Parse a typed quantity into thousandths.
 *
 * Accepts "2", "1.5", "0.25" and "1,5" — a comma decimal separator is what a
 * good many keyboards and habits produce, and rejecting it teaches nobody
 * anything. Returns null for anything else rather than guessing.
 */
export function parseQuantityToMilli(input: string): number | null {
  const clean = input.trim().replace(',', '.');
  if (!/^\d{0,6}(\.\d{1,3})?$/.test(clean) || clean === '' || clean === '.') return null;
  const value = Math.round(Number(clean) * 1000);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Thousandths back to something a person reads: 1000 -> "1", 1500 -> "1.5". */
export function formatQuantity(milli: number): string {
  const value = milli / 1000;
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** "hour" -> "hours" when there is more than one of them. */
export function pluraliseUnit(unit: string, milli: number): string {
  if (milli === 1000 || !unit) return unit;
  if (/(s|x|ch|sh)$/i.test(unit)) return `${unit}es`;
  if (/y$/i.test(unit) && !/[aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  return `${unit}s`;
}
