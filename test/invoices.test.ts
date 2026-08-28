import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  INVOICE_STATUS_LABELS, dueOn, isOverdue, outstanding, statusAfterPayment, totalsFor,
  type InvoiceItemRow, type InvoiceRow,
} from '../src/core/invoices';

const migration = readFileSync('migrations/0018_invoices.sql', 'utf8');

const invoice = (over: Partial<InvoiceRow>): InvoiceRow => ({
  id: 'inv_1', ref: 'INV-0001', quote_id: null, client_id: null, case_id: null,
  description: 'x', issued_on: '2026-08-01', due_on: '2026-08-08', payment_terms_days: 7,
  status: 'issued', currency: 'NZD', net_cents: 10000, gst_cents: 1500, gross_cents: 11500,
  paid_cents: 0, notes: null, xero_invoice_id: null, xero_pushed_at: null, xero_error: null,
  created_at: '', updated_at: '', created_by: null, issued_by: null,
  voided_at: null, void_reason: null, ...over,
});

describe('when payment falls due', () => {
  it('counts forward from the day of issue', () => {
    // Unlike a quote's validity, which is inclusive of its issue day: "due in
    // 7 days" on the 1st means the 8th, not the 7th.
    expect(dueOn('2026-08-01', 7)).toBe('2026-08-08');
    expect(dueOn('2026-08-01', 0)).toBe('2026-08-01');
  });

  it('crosses a month and a leap day without help', () => {
    expect(dueOn('2026-08-28', 7)).toBe('2026-09-04');
    expect(dueOn('2028-02-27', 3)).toBe('2028-03-01');
  });
});

describe('what is owed', () => {
  it('is the total less what has been paid', () => {
    expect(outstanding(invoice({ paid_cents: 4000 }))).toBe(7500);
  });

  it('never goes negative: an overpayment is not a debt', () => {
    expect(outstanding(invoice({ paid_cents: 99999 }))).toBe(0);
  });

  it('is nothing at all on a void invoice', () => {
    expect(outstanding(invoice({ status: 'void', paid_cents: 0 }))).toBe(0);
  });
});

describe('a payment moves an invoice, but only within its own life', () => {
  it('marks it part paid and then paid', () => {
    expect(statusAfterPayment('issued', 11500, 4000)).toBe('part_paid');
    expect(statusAfterPayment('issued', 11500, 11500)).toBe('paid');
    expect(statusAfterPayment('part_paid', 11500, 12000)).toBe('paid');
  });

  it('leaves a draft a draft — nothing has been demanded yet', () => {
    expect(statusAfterPayment('draft', 11500, 11500)).toBe('draft');
  });

  it('does not revive a void invoice', () => {
    // Money arriving against a voided invoice is a matter for the ledger, not
    // a reason to pretend the invoice is live again.
    expect(statusAfterPayment('void', 11500, 11500)).toBe('void');
  });
});

describe('overdue', () => {
  it('is past the due date with something still owed', () => {
    expect(isOverdue(invoice({ due_on: '2026-08-08' }), '2026-08-09')).toBe(true);
    expect(isOverdue(invoice({ due_on: '2026-08-08' }), '2026-08-08')).toBe(false);
  });

  it('is never true of something paid, void or still a draft', () => {
    for (const status of ['paid', 'void', 'draft'] as const) {
      expect(isOverdue(invoice({ status, due_on: '2020-01-01' }), '2026-08-09'), status).toBe(false);
    }
  });

  it('is never true when the whole amount has been received', () => {
    expect(isOverdue(invoice({ due_on: '2020-01-01', paid_cents: 11500 }), '2026-08-09')).toBe(false);
  });
});

describe('the totals are the quote\'s totals', () => {
  const line = (over: Partial<InvoiceItemRow>): InvoiceItemRow => ({
    id: 'x', invoice_id: 'inv_1', position: 0, service_item_id: null, description: 'x',
    kind: 'professional', unit_label: 'item', quantity_milli: 1000, unit_amount_cents: 10000,
    gst_treatment: 'exclusive', gst_rate_bp: 1500, net_cents: 10000, gst_cents: 1500,
    gross_cents: 11500, ...over,
  });

  it('separates fees from disbursements', () => {
    const totals = totalsFor([
      line({}),
      line({ kind: 'disbursement', gst_treatment: 'none', net_cents: 5500, gst_cents: 0, gross_cents: 5500 }),
    ]);
    expect(totals.feesNetCents).toBe(10000);
    expect(totals.disbursementsNetCents).toBe(5500);
    expect(totals.subtotalNetCents).toBe(15500);
    expect(totals.gstCents).toBe(1500);
    expect(totals.totalCents).toBe(17000);
  });

  it('says there is no GST when no line carries any', () => {
    const totals = totalsFor([line({ gst_treatment: 'none', gst_cents: 0, gross_cents: 10000 })]);
    expect(totals.hasGst).toBe(false);
  });
});

describe('an issued invoice is the database\'s business, not the route\'s', () => {
  it('refuses to alter the amounts, dates or number', () => {
    expect(migration).toContain('CREATE TRIGGER invoices_are_final_once_issued');
    for (const column of ['ref', 'issued_on', 'due_on', 'net_cents', 'gst_cents', 'gross_cents']) {
      expect(migration, column).toContain(column);
    }
  });

  it('still allows what legitimately changes afterwards', () => {
    // Payment, voiding and the Xero identifier are deliberately absent from the
    // trigger's condition — those are the things that happen to an invoice
    // after it is issued.
    const trigger = migration.slice(
      migration.indexOf('CREATE TRIGGER invoices_are_final_once_issued'),
      migration.indexOf('CREATE TRIGGER invoices_cannot_be_deleted'),
    );
    // The trigger fires on a comparison of NEW against OLD, so it is NEW.<col>
    // that says a column is frozen. `status` appears in the guard itself, which
    // is a different thing.
    for (const column of ['paid_cents', 'status', 'xero_invoice_id', 'voided_at', 'void_reason']) {
      expect(trigger, column).not.toContain(`NEW.${column}`);
    }
  });

  it('will not let an invoice be deleted, only voided', () => {
    expect(migration).toContain('CREATE TRIGGER invoices_cannot_be_deleted');
    expect(migration).toContain('an invoice cannot be deleted; void it instead');
  });

  it('freezes the lines on insert, update and delete', () => {
    for (const trigger of ['on_issue', 'on_update', 'on_delete']) {
      expect(migration, trigger).toContain(`CREATE TRIGGER invoice_items_frozen_${trigger}`);
    }
  });

  it('uses IFNULL rather than a NOT IN list on the delete trigger', () => {
    // `NULL NOT IN (...)` is NULL, which is not true, so a trigger written that
    // way never fires. This one was written that way once.
    expect(migration).toContain(
      "WHEN IFNULL((SELECT status FROM invoices WHERE id = OLD.invoice_id), 'draft') != 'draft'");
  });

  it('keeps payments append-only', () => {
    expect(migration).toContain('CREATE TRIGGER invoice_payments_are_append_only');
    expect(migration).toContain('CREATE TRIGGER invoice_payments_cannot_be_deleted');
  });

  it('will not store a payment without the person who recorded it', () => {
    expect(migration).toMatch(/created_by\s+TEXT NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/);
  });
});

describe('every status has a name', () => {
  it('labels each one the schema allows', () => {
    for (const status of ['draft', 'issued', 'part_paid', 'paid', 'void'] as const) {
      expect(INVOICE_STATUS_LABELS[status]).toBeTruthy();
      expect(migration).toContain(`'${status}'`);
    }
  });
});

describe('an invoice is addressed to somebody', () => {
  it('says so in the code that raises and issues one', () => {
    // A quote may sit against an inquiry that has not become a client yet. An
    // invoice may not: "TO —" is not an invoice.
    const core = readFileSync('src/core/invoices.ts', 'utf8');
    expect(core).toContain('an invoice has to be addressed to someone');
    expect(core).toContain('An invoice has to be addressed to someone');
  });
});
