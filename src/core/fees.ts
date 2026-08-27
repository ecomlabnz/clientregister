/**
 * Fee arithmetic: GST treatment, case totals and the revenue split.
 *
 * Two rules drive everything here:
 *
 *  1. Money is integer cents end to end. No float ever holds an amount that
 *     will be written to the database or shown to a client.
 *  2. A split must sum to exactly the base it divides. Percentages rarely
 *     divide cents evenly, so shares are allocated by the largest-remainder
 *     method: everyone gets their floor, then the leftover cents go to the
 *     largest fractional remainders. 100% of $333.33 split 3 ways is
 *     111.11 / 111.11 / 111.11 and the cent that is left lands somewhere
 *     deterministic rather than vanishing.
 */

export type GstTreatment = 'exclusive' | 'inclusive' | 'none';
export type FeeKind = 'professional' | 'disbursement' | 'third_party';
export type FeeStatus = 'quoted' | 'invoiced' | 'paid' | 'written_off' | 'cancelled';

export const GST_TREATMENTS: GstTreatment[] = ['exclusive', 'inclusive', 'none'];
export const GST_TREATMENT_LABELS: Record<GstTreatment, string> = {
  exclusive: 'Plus GST (amount is GST-exclusive)',
  inclusive: 'GST inclusive (amount already includes GST)',
  none: 'No GST (zero-rated or exempt)',
};

export const FEE_KINDS: FeeKind[] = ['professional', 'disbursement', 'third_party'];
export const FEE_KIND_LABELS: Record<FeeKind, string> = {
  professional: 'Professional fee',
  disbursement: 'Disbursement (INZ fee, medical, translation)',
  third_party: 'Third-party cost',
};

export const FEE_STATUSES: FeeStatus[] = ['quoted', 'invoiced', 'paid', 'written_off', 'cancelled'];
export const FEE_STATUS_LABELS: Record<FeeStatus, string> = {
  quoted: 'Quoted', invoiced: 'Invoiced', paid: 'Paid',
  written_off: 'Written off', cancelled: 'Cancelled',
};

/** What the split is calculated on. */
export type SplitBase = 'net_professional' | 'net_all' | 'gross_professional';
export const SPLIT_BASES: SplitBase[] = ['net_professional', 'net_all', 'gross_professional'];
export const SPLIT_BASE_LABELS: Record<SplitBase, string> = {
  net_professional: 'Professional fees, GST-exclusive (recommended)',
  net_all: 'All fees including disbursements, GST-exclusive',
  gross_professional: 'Professional fees including GST',
};

export interface GstBreakdown {
  net: number;
  gst: number;
  gross: number;
}

/** Round half away from zero — the convention invoices are checked against. */
export function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Split a typed amount into net / GST / gross.
 *
 *   exclusive: the amount is the net; GST is added on top.
 *   inclusive: the amount is the gross; GST is extracted from within it.
 *   none:      no GST applies; net and gross are the amount.
 */
export function computeGst(amountCents: number, treatment: GstTreatment, rateBp: number): GstBreakdown {
  const amount = Math.trunc(amountCents);
  if (treatment === 'none' || rateBp <= 0) {
    return { net: amount, gst: 0, gross: amount };
  }
  if (treatment === 'inclusive') {
    const net = roundCents((amount * 10000) / (10000 + rateBp));
    return { net, gst: amount - net, gross: amount };
  }
  const gst = roundCents((amount * rateBp) / 10000);
  return { net: amount, gst, gross: amount + gst };
}

export interface FeeLine {
  kind: FeeKind;
  net_cents: number;
  gst_cents: number;
  gross_cents: number;
  include_in_split: number | boolean;
  status: FeeStatus | string;
}

export interface FeeTotals {
  professionalNet: number;
  professionalGst: number;
  professionalGross: number;
  disbursementsNet: number;
  disbursementsGst: number;
  disbursementsGross: number;
  totalNet: number;
  totalGst: number;
  totalGross: number;
  /** Excludes cancelled and written-off lines. */
  invoicedGross: number;
  paidGross: number;
  outstandingGross: number;
  splitBaseCents: number;
}

/** Lines that never count toward money owed or split. */
function isLive(line: FeeLine): boolean {
  return line.status !== 'cancelled' && line.status !== 'written_off';
}

export function summariseFees(lines: FeeLine[], splitBase: SplitBase = 'net_professional'): FeeTotals {
  const t: FeeTotals = {
    professionalNet: 0, professionalGst: 0, professionalGross: 0,
    disbursementsNet: 0, disbursementsGst: 0, disbursementsGross: 0,
    totalNet: 0, totalGst: 0, totalGross: 0,
    invoicedGross: 0, paidGross: 0, outstandingGross: 0,
    splitBaseCents: 0,
  };

  for (const line of lines) {
    if (!isLive(line)) continue;
    if (line.kind === 'professional') {
      t.professionalNet += line.net_cents;
      t.professionalGst += line.gst_cents;
      t.professionalGross += line.gross_cents;
    } else {
      t.disbursementsNet += line.net_cents;
      t.disbursementsGst += line.gst_cents;
      t.disbursementsGross += line.gross_cents;
    }
    t.totalNet += line.net_cents;
    t.totalGst += line.gst_cents;
    t.totalGross += line.gross_cents;

    if (line.status === 'paid') {
      t.paidGross += line.gross_cents;
      t.invoicedGross += line.gross_cents;
    } else if (line.status === 'invoiced') {
      t.invoicedGross += line.gross_cents;
    }

    const included = line.include_in_split === 1 || line.include_in_split === true;
    if (!included) continue;
    if (splitBase === 'net_professional' && line.kind === 'professional') t.splitBaseCents += line.net_cents;
    else if (splitBase === 'gross_professional' && line.kind === 'professional') t.splitBaseCents += line.gross_cents;
    else if (splitBase === 'net_all') t.splitBaseCents += line.net_cents;
  }

  t.outstandingGross = t.invoicedGross - t.paidGross;
  return t;
}

export interface ShareInput {
  party_key: string;
  label: string;
  percent_bp: number;
}

export interface ShareAllocation extends ShareInput {
  amount_cents: number;
  percent: number;
}

/**
 * Allocate `baseCents` across shares by basis points, exactly.
 *
 * The returned amounts always sum to `baseCents` when the percentages sum to
 * 100%. If they sum to less, only that proportion is allocated (the remainder
 * is unallocated by design — the UI surfaces it rather than silently padding).
 */
export function allocateSplit(baseCents: number, shares: ShareInput[]): ShareAllocation[] {
  const totalBp = shares.reduce((sum, s) => sum + s.percent_bp, 0);
  if (shares.length === 0 || baseCents === 0 || totalBp === 0) {
    return shares.map((s) => ({ ...s, amount_cents: 0, percent: s.percent_bp / 100 }));
  }

  const exact = shares.map((s) => (baseCents * s.percent_bp) / 10000);
  const floors = exact.map((v) => Math.floor(v));
  const allocatedTotal = floors.reduce((a, b) => a + b, 0);

  // Only distribute up to the share of the base the percentages actually claim.
  const claimTotal = Math.floor((baseCents * Math.min(totalBp, 10000)) / 10000);
  let leftover = claimTotal - allocatedTotal;

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const amounts = [...floors];
  for (let i = 0; leftover > 0 && i < order.length; i++, leftover--) {
    amounts[order[i]!.index]! += 1;
  }

  return shares.map((s, i) => ({
    ...s,
    amount_cents: amounts[i] ?? 0,
    percent: s.percent_bp / 100,
  }));
}

/** Parse "70", "70%", "33.33" into basis points. */
export function parsePercentToBp(input: string): number | null {
  const clean = input.replace(/[%\s]/g, '');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  if (bp < 0 || bp > 10000) return null;
  return bp;
}

export function formatBp(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export function sumBp(shares: Array<{ percent_bp: number }>): number {
  return shares.reduce((sum, s) => sum + s.percent_bp, 0);
}
