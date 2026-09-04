import type { Env } from '../types';
import type { SettingsGroup } from './settings';
import { getSetting } from './db';

/**
 * Money: GST treatment, line kinds, and the revenue split.
 *
 * Renamed from `core/fees.ts` when the Fees section was removed and money
 * moved wholly into quotes and invoices. What is here is the arithmetic and
 * vocabulary those two share; what left with the Fees module was the fee
 * *line* — a quote line that could not be sent to anybody and an invoice line
 * that nobody owed.
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


/**
 * The practice's money settings.
 *
 * Read by quotes and invoices, which are now the only two places money is
 * recorded. They moved here from the Fees module rather than being copied into
 * one of them: two modules reading one set of settings from a third place is
 * right, and two modules each keeping their own GST rate is how a practice ends
 * up billing 15% on one document and 12.5% on the next.
 *
 * The keys keep their `fees.` prefix. Renaming them would mean a settings
 * migration to change nothing a person can see — the register's rule is to
 * change shape directly, and this is a name, not a shape.
 */
export interface DefaultShare { party_key: string; label: string; percent_bp: number }

export async function moneySettings(env: Env): Promise<{
  gstRateBp: number;
  gstRegistered: boolean;
  defaultTreatment: GstTreatment;
  splitBase: SplitBase;
  defaultShares: DefaultShare[];
}> {
  const [rate, registered, treatment, base, shares] = await Promise.all([
    getSetting(env, 'fees.gst_rate_bp', '1500'),
    getSetting(env, 'fees.gst_registered', 'true'),
    getSetting(env, 'fees.default_gst_treatment', 'exclusive'),
    getSetting(env, 'fees.split_base', 'net_professional'),
    getSetting(env, 'fees.default_shares', '[]'),
  ]);

  let defaultShares: DefaultShare[] = [];
  try {
    const parsed = JSON.parse(shares);
    if (Array.isArray(parsed)) defaultShares = parsed;
  } catch {
    defaultShares = [];
  }
  if (defaultShares.length === 0) {
    defaultShares = [{ party_key: 'principal', label: 'Principal', percent_bp: 10000 }];
  }

  const rateBp = Number(rate);
  return {
    gstRateBp: Number.isFinite(rateBp) ? rateBp : 1500,
    gstRegistered: registered === 'true',
    defaultTreatment: (GST_TREATMENTS as string[]).includes(treatment) ? (treatment as GstTreatment) : 'exclusive',
    splitBase: (SPLIT_BASES as string[]).includes(base) ? (base as SplitBase) : 'net_professional',
    defaultShares,
  };
}

/**
 * The settings tab these belong to. Declared here and mounted by the invoices
 * module, which is now where money is recorded — the register's rule is that a
 * module declares its own settings, and invoices is the module that has them.
 */
export const MONEY_SETTINGS: SettingsGroup = {
  id: 'fees',
  title: 'Money and GST',
  description: 'Defaults applied to new quote and invoice lines. Existing lines keep the rate and '
    + 'treatment they were entered under.',
  order: 20,
  settings: [
    { key: 'fees.gst_registered', type: 'boolean', label: 'The practice is GST registered',
      default: 'true', help: 'When off, no GST is calculated on new lines.' },
    { key: 'fees.gst_rate_bp', type: 'percent', label: 'GST rate', default: '1500',
      min: 0, max: 10000, help: 'New Zealand GST is 15%.' },
    { key: 'fees.default_gst_treatment', type: 'enum', label: 'Default treatment for new lines',
      default: 'exclusive',
      options: GST_TREATMENTS.map((t) => ({ value: t, label: GST_TREATMENT_LABELS[t] })) },
    { key: 'fees.split_base', type: 'enum', label: 'A split is calculated on',
      default: 'net_professional',
      options: SPLIT_BASES.map((b) => ({ value: b, label: SPLIT_BASE_LABELS[b] })) },
  ],
  note: 'default-shares',
};
