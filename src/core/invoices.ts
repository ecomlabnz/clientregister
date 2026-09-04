/**
 * Invoices.
 *
 * A quote is an offer and an invoice is a demand, and the difference shows up
 * in what may change afterwards. A quote can be withdrawn, superseded or
 * re-quoted; an invoice, once it has gone to a client, is a tax document with a
 * number in a sequence, and altering it is not a correction — it is a different
 * invoice pretending to be the same one. So an invoice is raised *from* a quote
 * rather than being the quote in another state, and the lines are copied so
 * that editing the quote or the catalogue afterwards changes nothing.
 *
 * The arithmetic is the quote's arithmetic, deliberately: the same functions,
 * so an invoice raised from a quote agrees with it to the cent. If they were
 * computed twice they would eventually disagree once.
 */

import type { Env } from '../types';
import { all, nextRef, nowIso, one, run } from './db';
import { newId } from './ids';
import { audit } from './audit';
import { computeLine, summariseQuote, type QuoteTotals } from './quotes';
import type { FeeKind, GstTreatment, SplitBase } from './money';

export type InvoiceStatus = 'draft' | 'issued' | 'part_paid' | 'paid' | 'void';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft', issued: 'Issued', part_paid: 'Part paid', paid: 'Paid', void: 'Void',
};

export type PaymentMethod = 'bank' | 'card' | 'cash' | 'other' | 'adjustment';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank: 'Bank transfer', card: 'Card', cash: 'Cash', other: 'Other',
  adjustment: 'Adjustment or write-off',
};

export interface InvoiceRow {
  id: string;
  ref: string;
  quote_id: string | null;
  client_id: string | null;
  case_id: string | null;
  description: string;
  issued_on: string | null;
  due_on: string | null;
  payment_terms_days: number;
  status: InvoiceStatus;
  currency: string;
  net_cents: number;
  gst_cents: number;
  gross_cents: number;
  paid_cents: number;
  notes: string | null;
  xero_invoice_id: string | null;
  xero_pushed_at: string | null;
  xero_error: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  issued_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface InvoiceItemRow {
  id: string;
  invoice_id: string;
  position: number;
  service_item_id: string | null;
  description: string;
  kind: FeeKind;
  unit_label: string;
  quantity_milli: number;
  unit_amount_cents: number;
  gst_treatment: GstTreatment;
  gst_rate_bp: number;
  net_cents: number;
  gst_cents: number;
  gross_cents: number;
}

export interface PaymentRow {
  id: string;
  invoice_id: string;
  paid_on: string;
  amount_cents: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  created_at: string;
  created_by: string;
  author?: string | null;
}

/** The day payment falls due, counted forward from the day of issue. */
export function dueOn(issuedOn: string, termDays: number): string {
  const span = Math.max(0, Math.floor(termDays));
  const at = new Date(`${issuedOn.slice(0, 10)}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + span);
  return at.toISOString().slice(0, 10);
}

/** What is still owed. Never negative: an overpayment is not a debt. */
export function outstanding(invoice: Pick<InvoiceRow, 'gross_cents' | 'paid_cents' | 'status'>): number {
  if (invoice.status === 'void') return 0;
  return Math.max(0, invoice.gross_cents - invoice.paid_cents);
}

/**
 * The status a payment leaves an invoice in.
 *
 * Only ever moves an issued invoice between issued, part paid and paid: a draft
 * stays a draft (nothing has been demanded yet) and a void invoice stays void
 * (money received against it is a matter for the ledger, not for reviving it).
 */
export function statusAfterPayment(current: InvoiceStatus, grossCents: number, paidCents: number): InvoiceStatus {
  if (current === 'draft' || current === 'void') return current;
  if (paidCents <= 0) return 'issued';
  return paidCents >= grossCents ? 'paid' : 'part_paid';
}

/** Whether an invoice is past its due date and still owed, as at `today`. */
export function isOverdue(invoice: Pick<InvoiceRow, 'due_on' | 'status' | 'gross_cents' | 'paid_cents'>, today: string): boolean {
  if (!invoice.due_on) return false;
  if (invoice.status !== 'issued' && invoice.status !== 'part_paid') return false;
  return invoice.due_on < today && outstanding(invoice as InvoiceRow) > 0;
}

export function totalsFor(items: InvoiceItemRow[]): QuoteTotals {
  return summariseQuote(items.map((i) => ({
    kind: i.kind, lineAmountCents: i.net_cents + (i.gst_treatment === 'inclusive' ? i.gst_cents : 0),
    netCents: i.net_cents, gstCents: i.gst_cents, grossCents: i.gross_cents,
  })));
}

export async function invoiceItems(env: Env, invoiceId: string): Promise<InvoiceItemRow[]> {
  return all<InvoiceItemRow>(
    env.DB, `SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, created_at`, invoiceId,
  );
}

/** Recompute the stored totals from the lines. Draft invoices only. */
export async function refreshTotals(env: Env, invoiceId: string): Promise<QuoteTotals> {
  const items = await invoiceItems(env, invoiceId);
  const totals = totalsFor(items);
  await run(
    env.DB,
    `UPDATE invoices SET net_cents = ?, gst_cents = ?, gross_cents = ?, updated_at = ? WHERE id = ?`,
    totals.subtotalNetCents, totals.gstCents, totals.totalCents, nowIso(), invoiceId,
  );
  return totals;
}

/**
 * Raise an invoice on its own.
 *
 * Until now the only way to bill anything was to write a quote first and
 * convert it — which is a fair description of how the work usually goes, and a
 * poor description of the times it does not. The practice put it plainly:
 * *"both being able to be entered independently"*. An hour of advice given and
 * charged for needs a bill, not an offer followed by a bill.
 *
 * It starts empty and in draft. Lines are added exactly as they are added to an
 * invoice raised from a quote, and issuing it is the same act with the same
 * consequences — from that moment the database stops accepting changes.
 *
 * The one thing that cannot be left out is who it is addressed to. A quote may
 * sit against an inquiry that has not become a client yet; an invoice may not.
 */
export async function newInvoice(
  env: Env,
  input: { clientId: string; caseId?: string | null; description: string; termDays?: number; currency?: string },
  userId: string,
): Promise<{ ok: true; id: string; ref: string } | { ok: false; message: string }> {
  const description = input.description.trim();
  if (description === '') return { ok: false, message: 'Say what this invoice is for.' };

  const client = await one<{ id: string }>(
    env.DB, 'SELECT id FROM clients WHERE id = ?', input.clientId);
  if (!client) return { ok: false, message: 'Choose an existing client — an invoice has to be addressed to someone.' };

  // A matter is optional, but if one is named it must belong to that client.
  // An invoice filed against somebody else's matter is a mistake nobody spots
  // until they go looking for the money.
  if (input.caseId) {
    const matter = await one<{ client_id: string }>(
      env.DB, 'SELECT client_id FROM cases WHERE id = ?', input.caseId);
    if (!matter) return { ok: false, message: 'That matter no longer exists.' };
    if (matter.client_id !== input.clientId) {
      return { ok: false, message: 'That matter belongs to a different client.' };
    }
  }

  const id = newId('inv');
  const ref = await nextRef(env.DB, 'invoice', 'INV');
  const stamp = nowIso();
  const termDays = Math.max(0, Math.min(365, input.termDays ?? 7));

  await run(
    env.DB,
    `INSERT INTO invoices (id, ref, quote_id, client_id, case_id, description, payment_terms_days,
                           status, currency, created_at, updated_at, created_by)
     VALUES (?,?,NULL,?,?,?,?, 'draft', ?,?,?,?)`,
    id, ref, input.clientId, input.caseId ?? null, description, termDays,
    input.currency ?? 'NZD', stamp, stamp, userId,
  );
  await refreshTotals(env, id);
  return { ok: true, id, ref };
}

/**
 * Raise an invoice from a quote.
 *
 * The quote is left exactly as it is. A quote may reasonably be invoiced more
 * than once — that is what staged fees are — so nothing here consumes it, and
 * the invoice keeps a link back rather than a claim over it.
 */
export async function invoiceFromQuote(
  env: Env, quoteId: string, userId: string, opts: { termDays?: number; onlyStage?: string | null } = {},
): Promise<{ ok: true; id: string; ref: string } | { ok: false; message: string }> {
  const quote = await one<{
    id: string; ref: string; client_id: string | null; case_id: string | null;
    description: string; currency: string;
  }>(env.DB, `SELECT * FROM quotes WHERE id = ?`, quoteId);
  if (!quote) return { ok: false, message: 'That quote no longer exists.' };

  const lines = await all<any>(
    env.DB, `SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position, created_at`, quoteId,
  );
  if (lines.length === 0) {
    return { ok: false, message: 'That quote has no lines, so there is nothing to invoice.' };
  }
  // An invoice is addressed to somebody by definition. A quote may sit against
  // an inquiry that has not become a client yet; an invoice may not.
  if (!quote.client_id) {
    return { ok: false, message: 'Link this quote to a client first — an invoice has to be addressed to someone.' };
  }

  const id = newId('inv');
  const ref = await nextRef(env.DB, 'invoice', 'INV');
  const stamp = nowIso();
  const termDays = Math.max(0, Math.min(365, opts.termDays ?? 7));

  await run(
    env.DB,
    `INSERT INTO invoices (id, ref, quote_id, client_id, case_id, description, payment_terms_days,
                           status, currency, created_at, updated_at, created_by)
     VALUES (?,?,?,?,?,?,?, 'draft', ?,?,?,?)`,
    id, ref, quote.id, quote.client_id, quote.case_id,
    `${quote.description} (from ${quote.ref})`, termDays, quote.currency ?? 'NZD', stamp, stamp, userId,
  );

  for (const [index, line] of lines.entries()) {
    // Recomputed rather than copied across: if the two ever disagreed, the
    // invoice would be the one a client checks with a calculator.
    const amounts = computeLine({
      quantityMilli: line.quantity_milli, unitAmountCents: line.unit_amount_cents,
      gstTreatment: line.gst_treatment, gstRateBp: line.gst_rate_bp,
    });
    await run(
      env.DB,
      `INSERT INTO invoice_items (id, invoice_id, position, service_item_id, description, kind,
              unit_label, quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
              net_cents, gst_cents, gross_cents, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      newId('ili'), id, index, line.service_item_id, line.description, line.kind,
      line.unit_label, line.quantity_milli, line.unit_amount_cents, line.gst_treatment,
      line.gst_rate_bp, amounts.netCents, amounts.gstCents, amounts.grossCents, stamp,
    );
  }

  await refreshTotals(env, id);
  await audit(env, {
    action: 'invoice.created_from_quote', entityType: 'invoice', entityId: id, actorId: userId,
    meta: { quote: quote.ref, ref, lines: lines.length },
  });
  return { ok: true, id, ref };
}

/**
 * Issue an invoice: fix its date, work out when it falls due, and hand it to
 * the database's keeping. After this the triggers refuse every change but
 * payment, voiding, and the record of a push to Xero.
 */
export async function issueInvoice(
  env: Env, invoiceId: string, userId: string, issuedOn: string,
): Promise<{ ok: boolean; message: string }> {
  const invoice = await one<InvoiceRow>(env.DB, `SELECT * FROM invoices WHERE id = ?`, invoiceId);
  if (!invoice) return { ok: false, message: 'That invoice no longer exists.' };
  if (invoice.status !== 'draft') return { ok: false, message: 'That invoice has already been issued.' };

  const items = await invoiceItems(env, invoiceId);
  if (items.length === 0) return { ok: false, message: 'Add at least one line before issuing.' };
  if (!invoice.client_id) {
    return { ok: false, message: 'This invoice has no client on it. An invoice has to be addressed to someone.' };
  }

  const totals = totalsFor(items);
  const date = issuedOn.slice(0, 10);
  await run(
    env.DB,
    `UPDATE invoices SET status = 'issued', issued_on = ?, due_on = ?, issued_by = ?,
            net_cents = ?, gst_cents = ?, gross_cents = ?, updated_at = ?
      WHERE id = ? AND status = 'draft'`,
    date, dueOn(date, invoice.payment_terms_days), userId,
    totals.subtotalNetCents, totals.gstCents, totals.totalCents, nowIso(), invoiceId,
  );

  await audit(env, {
    action: 'invoice.issued', entityType: 'invoice', entityId: invoiceId, actorId: userId,
    meta: { ref: invoice.ref, total: totals.totalCents, issuedOn: date },
  });
  return { ok: true, message: `${invoice.ref} issued. It cannot be altered now — void it and raise another if it is wrong.` };
}

/** Record money received. Payments are only ever added. */
export async function recordPayment(
  env: Env,
  input: { invoiceId: string; paidOn: string; amountCents: number; method: PaymentMethod;
           reference: string | null; note: string | null; userId: string },
): Promise<{ ok: boolean; message: string }> {
  const invoice = await one<InvoiceRow>(env.DB, `SELECT * FROM invoices WHERE id = ?`, input.invoiceId);
  if (!invoice) return { ok: false, message: 'That invoice no longer exists.' };
  if (invoice.status === 'draft') {
    return { ok: false, message: 'Issue the invoice before recording a payment against it.' };
  }
  if (input.amountCents === 0) return { ok: false, message: 'Enter an amount.' };

  await run(
    env.DB,
    `INSERT INTO invoice_payments (id, invoice_id, paid_on, amount_cents, method, reference, note,
                                   created_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    newId('pay'), input.invoiceId, input.paidOn.slice(0, 10), input.amountCents, input.method,
    input.reference, input.note, nowIso(), input.userId,
  );

  const paid = await one<{ total: number }>(
    env.DB, `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoice_payments WHERE invoice_id = ?`,
    input.invoiceId,
  );
  const paidCents = paid?.total ?? 0;
  await run(
    env.DB, `UPDATE invoices SET paid_cents = ?, status = ?, updated_at = ? WHERE id = ?`,
    paidCents, statusAfterPayment(invoice.status, invoice.gross_cents, paidCents), nowIso(), input.invoiceId,
  );

  await audit(env, {
    action: 'invoice.payment', entityType: 'invoice', entityId: input.invoiceId, actorId: input.userId,
    meta: { ref: invoice.ref, amount: input.amountCents, method: input.method },
  });
  return { ok: true, message: 'Payment recorded.' };
}

export async function voidInvoice(
  env: Env, invoiceId: string, userId: string, reason: string,
): Promise<{ ok: boolean; message: string }> {
  const invoice = await one<InvoiceRow>(env.DB, `SELECT * FROM invoices WHERE id = ?`, invoiceId);
  if (!invoice) return { ok: false, message: 'That invoice no longer exists.' };
  if (invoice.status === 'void') return { ok: false, message: 'That invoice is already void.' };

  await run(
    env.DB,
    `UPDATE invoices SET status = 'void', voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?`,
    nowIso(), reason.slice(0, 500) || 'Voided', nowIso(), invoiceId,
  );
  await audit(env, {
    action: 'invoice.voided', entityType: 'invoice', entityId: invoiceId, actorId: userId,
    meta: { ref: invoice.ref, reason: reason.slice(0, 200) },
  });
  return { ok: true, message: `${invoice.ref} voided. The number stays in the sequence, with the reason on it.` };
}

export async function paymentsFor(env: Env, invoiceId: string): Promise<PaymentRow[]> {
  return all<PaymentRow>(
    env.DB,
    `SELECT p.*, u.name AS author FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.created_by
      WHERE p.invoice_id = ? ORDER BY p.paid_on, p.created_at`,
    invoiceId,
  );
}

export interface InvoiceShareRow {
  id: string; invoice_id: string; party_key: string; label: string;
  percent_bp: number; user_id: string | null; position: number;
}

/**
 * The base a split divides.
 *
 * Only professional fees by default, GST-exclusive. Disbursements are money
 * passed through on the client's behalf — an INZ fee, a medical, a translation
 * — and apportioning them would hand somebody a share of another organisation's
 * fee. The practice can change the base in Settings; it cannot change what a
 * disbursement is.
 */
export function splitBaseFor(
  lines: Array<{ kind: string; net_cents: number; gross_cents: number }>,
  base: SplitBase,
): number {
  if (base === 'net_all') return lines.reduce((n, l) => n + l.net_cents, 0);
  const professional = lines.filter((l) => l.kind === 'professional');
  return base === 'gross_professional'
    ? professional.reduce((n, l) => n + l.gross_cents, 0)
    : professional.reduce((n, l) => n + l.net_cents, 0);
}

/** The split on an invoice, in the order it was entered. */
export async function sharesFor(env: Env, invoiceId: string): Promise<InvoiceShareRow[]> {
  return all<InvoiceShareRow>(
    env.DB,
    'SELECT * FROM invoice_shares WHERE invoice_id = ? ORDER BY position, rowid', invoiceId);
}
