/**
 * Module: invoices.
 *
 * A quote is an offer; an invoice is a demand with a number in a sequence, and
 * the difference is what may change afterwards. While an invoice is a draft it
 * behaves like anything else on the register. The moment it is issued the
 * database stops accepting changes to it — the amounts, the dates and the lines
 * are fixed, and only payment, voiding and the record of a push to Xero are
 * still allowed. That is enforced by triggers rather than by these routes, so
 * it holds however the row is reached.
 *
 * Nothing is deleted here. A wrong invoice is voided, with its reason, and its
 * number stays in the sequence: a gap in an invoice sequence is the first thing
 * an auditor asks about.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { everyTermClausePlain } from '../../core/search';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { all, nextRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { FormReader } from '../../core/validate';
import { can } from '../../core/rbac';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, field, optionsFrom, pageHeader, select, stamp, table,
} from '../../ui/components';
import { dateShort, money } from '../../ui/format';
import { FEE_KINDS, FEE_KIND_LABELS, GST_TREATMENTS, GST_TREATMENT_LABELS,
         type FeeKind, type GstTreatment } from '../../core/fees';
import { computeLine, formatQuantity, parseQuantityToMilli, pluraliseUnit } from '../../core/quotes';
import { practiceDetails } from '../../core/practice';
import { feeSettings } from '../fees';
import { catalogue } from '../quotes';
import {
  INVOICE_STATUS_LABELS, PAYMENT_METHOD_LABELS, type InvoiceRow, type PaymentMethod,
  invoiceItems, issueInvoice, isOverdue, outstanding, paymentsFor, recordPayment,
  refreshTotals, totalsFor, voidInvoice,
} from '../../core/invoices';

const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  draft: 'neutral', issued: 'amber', part_paid: 'amber', paid: 'green', void: 'neutral',
};

const PAYMENT_METHODS: PaymentMethod[] = ['bank', 'card', 'cash', 'other', 'adjustment'];

/** Today in New Zealand, as a plain date, for comparing with stored dates. */
function todayNz(): string {
  return new Date(Date.now() + 12 * 3_600_000).toISOString().slice(0, 10);
}

export const invoicesModule: AppModule = {
  name: 'invoices',
  title: 'Invoices',
  basePaths: ['/invoices'],
  // In the run under Money, between Quotes and Fees, which is the order the
  // work happens in: a quote before it, an invoice after it, the fee ledger
  // underneath both. The page has existed since 0.66.0 and was reachable only
  // through a tab on the quotes list — which is to say, only if you already
  // knew it was there. "What are we owed" is a question the practice asks of
  // the register directly, not by way of quotes.
  nav: [{ href: '/invoices', label: 'Invoices', permission: 'register:read', order: 50, group: 'Money' }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // --- The list -----------------------------------------------------------
    r.get('/', requirePermission('register:read'), async (c) => {
      const view = ['draft', 'owing', 'paid', 'void', 'all'].includes(c.req.query('view') ?? '')
        ? c.req.query('view')! : 'owing';
      const q0 = (c.req.query('q') ?? '').trim();

      const conds: string[] = [];
      const params: unknown[] = [];
      if (view === 'draft') conds.push(`i.status = 'draft'`);
      else if (view === 'owing') conds.push(`i.status IN ('issued','part_paid')`);
      else if (view === 'paid') conds.push(`i.status = 'paid'`);
      else if (view === 'void') conds.push(`i.status = 'void'`);
      if (q0) {
        const m = everyTermClausePlain(['i.ref', 'i.description', 'cl.full_name'], q0);
        if (m.sql) { conds.push(m.sql); params.push(...m.params); }
      }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const [rows, counts] = await Promise.all([
        all<InvoiceRow & { client_name: string | null; case_ref: string | null }>(
          c.env.DB,
          `SELECT i.*, cl.full_name AS client_name, k.ref AS case_ref FROM invoices i
             LEFT JOIN clients cl ON cl.id = i.client_id
             LEFT JOIN cases k ON k.id = i.case_id
             ${whereSql} ORDER BY i.created_at DESC LIMIT 200`,
          ...params,
        ),
        one<{ draft: number; owing: number; paid: number; voided: number; total: number;
              owed: number }>(
          c.env.DB,
          `SELECT SUM(status = 'draft') AS draft,
                  SUM(status IN ('issued','part_paid')) AS owing,
                  SUM(status = 'paid') AS paid,
                  SUM(status = 'void') AS voided,
                  COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN status IN ('issued','part_paid')
                                    THEN gross_cents - paid_cents ELSE 0 END), 0) AS owed
             FROM invoices`,
        ),
      ]);

      const today = todayNz();
      const overdue = rows.filter((i) => isOverdue(i, today));
      const views = [
        { id: 'owing', label: 'Owing', count: counts?.owing ?? 0 },
        { id: 'draft', label: 'Draft', count: counts?.draft ?? 0 },
        { id: 'paid', label: 'Paid', count: counts?.paid ?? 0 },
        { id: 'void', label: 'Void', count: counts?.voided ?? 0 },
        { id: 'all', label: 'All', count: counts?.total ?? 0 },
      ];

      return page(c, { title: 'Invoices', active: '/quotes' }, html`
        ${pageHeader('Invoices', 'What has been billed, and what is still owed.')}

        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Outstanding</span>
            <span class="stat-value">${money(counts?.owed ?? 0)}</span></div>
          <div class="stat ${overdue.length ? 'stat-warn' : ''}"><span class="stat-label">Overdue</span>
            <span class="stat-value">${overdue.length}</span></div>
          <div class="stat"><span class="stat-label">Drafts</span>
            <span class="stat-value">${counts?.draft ?? 0}</span></div>
        </div>

        <nav class="tabs">
          ${'' /* The tabs on this row are views of this list — owing, draft,
                   paid. A link sideways to another list used to sit among them
                   because invoices had no place in the menu; they do now, so it
                   would only be navigation pretending to be a filter. */}
          ${views.map((v) => html`
            <a class="${v.id === view ? 'tab current' : 'tab'}"
               href="${`/invoices?view=${v.id}`}">${v.label} <span class="muted">${v.count}</span></a>`)}
        </nav>

        <form method="get" action="/invoices" class="filters" data-live-search>
          <input type="hidden" name="view" value="${view}">
          <input type="search" name="q" value="${q0}" placeholder="Search reference, description or client">
          <button class="btn btn-secondary js-hide" type="submit">Search</button>
        </form>

        <div data-live-results>
        ${table([
          { label: 'Reference', width: '12', hideOn: 'sm' },
          { label: 'Client', width: '18', hideOn: 'sm' },
          { label: 'Description', width: '28' },
          { label: 'Total', width: '13', align: 'right' },
          { label: 'Owing', width: '13', align: 'right' },
          { label: 'Due', width: '16' },
        ], rows.map((row) => html`
          <tr class="${isOverdue(row, today) ? 'row-urgent' : ''}">
            <td class="col-sm-hide"><a href="/invoices/${row.id}"><code>${row.ref}</code></a></td>
            <td class="small col-sm-hide">${row.client_id
              ? html`<a href="/clients/${row.client_id}">${row.client_name}</a>` : '—'}</td>
            <td><a class="clamp-2" href="/invoices/${row.id}">${row.description}</a>
              <div class="row-meta show-sm">
                <code>${row.ref}</code>
                ${row.client_name ? html`<span class="muted">${row.client_name}</span>` : ''}
                ${badge(INVOICE_STATUS_LABELS[row.status], STATUS_TONES[row.status] ?? 'neutral')}
              </div></td>
            <td class="num">${money(row.gross_cents, row.currency)}</td>
            <td class="num strong">${money(outstanding(row), row.currency)}</td>
            <td class="small">${row.due_on ? dateShort(row.due_on) : '—'}
              <div>${badge(INVOICE_STATUS_LABELS[row.status], STATUS_TONES[row.status] ?? 'neutral')}</div></td>
          </tr>`), { sticky: true, fixed: true, empty: 'No invoices in this view.' })}
        </div>`);
    });

    // --- One invoice --------------------------------------------------------
    r.get('/:id', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const invoice = await one<InvoiceRow & { client_name: string | null; case_ref: string | null;
                                               quote_ref: string | null; issuer: string | null }>(
        c.env.DB,
        `SELECT i.*, cl.full_name AS client_name, k.ref AS case_ref, q.ref AS quote_ref,
                u.name AS issuer
           FROM invoices i
           LEFT JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN cases k ON k.id = i.case_id
           LEFT JOIN quotes q ON q.id = i.quote_id
           LEFT JOIN users u ON u.id = i.issued_by
          WHERE i.id = ?`,
        id,
      );
      if (!invoice) return c.notFound();

      const [items, payments, cat, fees] = await Promise.all([
        invoiceItems(c.env, id), paymentsFor(c.env, id), catalogue(c.env), feeSettings(c.env),
      ]);
      const totals = totalsFor(items);
      const csrf = c.get('session')!.csrf;
      const editable = invoice.status === 'draft' && can(c.get('user'), 'quote:write');
      const today = todayNz();

      return page(c, { title: `Invoice ${invoice.ref}`, active: '/quotes' }, html`
        ${breadcrumbs([{ label: 'Quotes', href: '/quotes' },
                       { label: 'Invoices', href: '/invoices' }, { label: invoice.ref }])}
        ${pageHeader(`Invoice ${invoice.ref}`, invoice.description, html`
          <a class="btn btn-secondary" href="${`/invoices/${invoice.id}/print`}">Print view</a>`)}

        ${invoice.status === 'void' ? html`
          <div class="alert alert-warn">
            <p><strong>This invoice is void.</strong> ${invoice.void_reason ?? ''}</p>
            <p class="mb">The number stays in the sequence deliberately — a gap is what somebody
               later asks about.</p>
          </div>` : ''}
        ${isOverdue(invoice, today) ? html`
          <div class="alert alert-warn">
            <p><strong>Overdue.</strong> It fell due on ${dateShort(invoice.due_on)} and
               ${money(outstanding(invoice), invoice.currency)} is still owed.</p>
          </div>` : ''}

        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Total</span>
            <span class="stat-value">${money(invoice.gross_cents, invoice.currency)}</span></div>
          <div class="stat"><span class="stat-label">Paid</span>
            <span class="stat-value">${money(invoice.paid_cents, invoice.currency)}</span></div>
          <div class="stat ${outstanding(invoice) ? 'stat-warn' : ''}"><span class="stat-label">Owing</span>
            <span class="stat-value">${money(outstanding(invoice), invoice.currency)}</span></div>
        </div>

        <div class="cols">
          <div class="col-main">
            ${card('Lines', html`
              ${items.length === 0
                ? emptyState('No lines yet.')
                : table([
                    { label: 'Description', width: '44' },
                    { label: 'Qty', width: '12', align: 'right', hideOn: 'sm' },
                    { label: 'Unit', width: '14', align: 'right', hideOn: 'sm' },
                    { label: 'Amount', width: '16', align: 'right' },
                    ...(editable ? [{ label: '', width: '14' as const }] : []),
                  ], items.map((line) => html`
                    <tr>
                      <td>${line.description}
                        <div class="row-meta">
                          ${line.kind === 'professional' ? '' : badge(FEE_KIND_LABELS[line.kind], 'neutral')}
                          <span class="muted show-sm">${formatQuantity(line.quantity_milli)}
                            ${pluraliseUnit(line.unit_label, line.quantity_milli)}
                            × ${money(line.unit_amount_cents, invoice.currency)}</span>
                        </div></td>
                      <td class="num col-sm-hide">${formatQuantity(line.quantity_milli)}
                        ${pluraliseUnit(line.unit_label, line.quantity_milli)}</td>
                      <td class="num col-sm-hide">${money(line.unit_amount_cents, invoice.currency)}</td>
                      <td class="num">${money(line.net_cents, invoice.currency)}</td>
                      ${editable ? html`<td>${actionButton(
                        `/invoices/${invoice.id}/items/${line.id}/remove`, csrf, 'Remove',
                        { className: 'btn btn-danger btn-small', confirm: 'Remove this line?' })}</td>` : ''}
                    </tr>`), { fixed: true })}

              <dl class="kv mt">
                <dt>Subtotal</dt><dd>${money(totals.subtotalNetCents, invoice.currency)}</dd>
                ${totals.hasGst
                  ? html`<dt>GST</dt><dd>${money(totals.gstCents, invoice.currency)}</dd>`
                  : html`<dt>GST</dt><dd class="muted">None applies</dd>`}
                <dt>Total</dt><dd class="strong">${money(totals.totalCents, invoice.currency)}</dd>
              </dl>

              ${editable ? html`
                <details class="mt">
                  <summary>Add a line</summary>
                  <form method="post" action="${`/invoices/${invoice.id}/items`}" class="row-form js-quote-line">
                    ${csrfField(csrf)}
                    <div class="field">
                      <label for="f_service_item_id">From the catalogue</label>
                      <select id="f_service_item_id" name="service_item_id" class="js-catalogue">
                        <option value="">— type it in below —</option>
                        ${cat.map((it) => html`<option value="${it.id}"
                            data-description="${it.description || it.name}"
                            data-kind="${it.kind}" data-unit="${it.unit_label}"
                            data-amount="${(it.unit_amount_cents / 100).toFixed(2)}"
                            data-gst="${it.gst_treatment}">${it.name}</option>`)}
                      </select>
                    </div>
                    ${field({ label: 'Description', name: 'description', required: true, maxlength: 300 })}
                    ${field({ label: 'Quantity', name: 'quantity', value: '1', required: true, maxlength: 10 })}
                    ${field({ label: 'Unit', name: 'unit_label', value: 'item', maxlength: 30 })}
                    ${field({ label: 'Price per unit', name: 'unit_amount', required: true, placeholder: '0.00' })}
                    ${select({ label: 'Type', name: 'kind', value: 'professional', includeBlank: false,
                               options: optionsFrom(FEE_KINDS, FEE_KIND_LABELS) })}
                    ${select({ label: 'GST', name: 'gst_treatment',
                               value: fees.gstRegistered ? fees.defaultTreatment : 'none',
                               includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
                    <button class="btn btn-primary" type="submit">Add line</button>
                  </form>
                </details>` : ''}`)}

            ${card('Payments', html`
              ${payments.length === 0
                ? emptyState('Nothing received against this invoice yet.')
                : table([
                    { label: 'Date', width: '20' },
                    { label: 'Amount', width: '20', align: 'right' },
                    { label: 'How', width: '24', hideOn: 'sm' },
                    { label: 'Reference', width: '36', hideOn: 'sm' },
                  ], payments.map((p) => html`
                    <tr>
                      <td class="small">${dateShort(p.paid_on)}
                        <div class="muted">${p.author ?? ''}</div></td>
                      <td class="num ${p.amount_cents < 0 ? 'warn' : ''}">${money(p.amount_cents, invoice.currency)}</td>
                      <td class="small col-sm-hide">${PAYMENT_METHOD_LABELS[p.method] ?? p.method}</td>
                      <td class="small col-sm-hide">${p.reference ?? ''}
                        ${p.note ? html`<div class="muted">${p.note}</div>` : ''}</td>
                    </tr>`), { fixed: true })}

              ${invoice.status !== 'draft' && invoice.status !== 'void' && can(c.get('user'), 'quote:write') ? html`
                <details class="mt">
                  <summary>Record a payment</summary>
                  <form method="post" action="${`/invoices/${invoice.id}/payments`}" class="row-form">
                    ${csrfField(csrf)}
                    ${field({ label: 'Date received', name: 'paid_on', type: 'date', value: today, required: true })}
                    ${field({ label: 'Amount', name: 'amount', required: true,
                              placeholder: money(outstanding(invoice), invoice.currency).replace(/[^\d.]/g, '') })}
                    ${select({ label: 'How', name: 'method', value: 'bank', includeBlank: false,
                               options: optionsFrom(PAYMENT_METHODS, PAYMENT_METHOD_LABELS) })}
                    ${field({ label: 'Reference', name: 'reference', maxlength: 120 })}
                    ${field({ label: 'Note', name: 'note', maxlength: 300 })}
                    <button class="btn btn-primary" type="submit">Record it</button>
                  </form>
                  <p class="hint">Payments are added, never edited. A mistake is corrected by a
                     second entry — choose <strong>Adjustment</strong> and enter a negative amount,
                     which is how a ledger stays a record rather than an opinion.</p>
                </details>` : ''}`)}
          </div>

          <div class="col-side">
            ${card('Details', html`
              <dl class="kv">
                <dt>Status</dt><dd>${badge(INVOICE_STATUS_LABELS[invoice.status],
                  STATUS_TONES[invoice.status] ?? 'neutral')}</dd>
                <dt>Client</dt><dd>${invoice.client_id
                  ? html`<a href="/clients/${invoice.client_id}">${invoice.client_name}</a>` : '—'}</dd>
                ${invoice.case_id ? html`<dt>Matter</dt>
                  <dd><a href="/cases/${invoice.case_id}">${invoice.case_ref}</a></dd>` : ''}
                ${invoice.quote_id ? html`<dt>From quote</dt>
                  <dd><a href="/quotes/${invoice.quote_id}">${invoice.quote_ref}</a></dd>` : ''}
                <dt>Issued</dt><dd>${invoice.issued_on ? dateShort(invoice.issued_on) : 'Not yet'}</dd>
                <dt>Due</dt><dd>${invoice.due_on ? dateShort(invoice.due_on) : `${invoice.payment_terms_days} days from issue`}</dd>
                ${invoice.issuer ? html`<dt>Issued by</dt><dd>${invoice.issuer}</dd>` : ''}
              </dl>`)}

            ${invoice.status === 'draft' && can(c.get('user'), 'quote:write') ? card('Issue it', html`
              <form method="post" action="${`/invoices/${invoice.id}/issue`}" class="entry-form"
                    data-confirm="Issue this invoice? After this it cannot be altered.">
                ${csrfField(csrf)}
                ${field({ label: 'Date of issue', name: 'issued_on', type: 'date', value: today, required: true })}
                <button class="btn btn-primary" type="submit">Issue this invoice</button>
                <p class="hint">Once issued, the amounts, dates and lines are fixed — the database
                   refuses to change them. If it is wrong after that, void it and raise another.</p>
              </form>`) : ''}

            ${invoice.status !== 'void' && invoice.status !== 'draft' && can(c.get('user'), 'quote:write')
              ? card('Void it', html`
                <form method="post" action="${`/invoices/${invoice.id}/void`}" class="entry-form"
                      data-confirm="Void this invoice? The number stays, with your reason on it.">
                  ${csrfField(csrf)}
                  ${field({ label: 'Reason', name: 'reason', required: true, maxlength: 300 })}
                  <button class="btn btn-danger" type="submit">Void</button>
                </form>`) : ''}

            ${card('Xero', html`
              ${invoice.xero_invoice_id
                ? html`<p class="small">Pushed on ${stamp(invoice.xero_pushed_at)} as
                         <code>${invoice.xero_invoice_id}</code>.</p>`
                : html`<p class="small muted">Not connected yet. When it is, an issued invoice can be
                          pushed from here and the Xero identifier recorded against it, so the two
                          systems agree about which invoice is which.</p>`}
              ${invoice.xero_error ? html`<p class="small warn">${invoice.xero_error}</p>` : ''}`)}
          </div>
        </div>`);
    });

    // --- Lines --------------------------------------------------------------
    r.post('/:id/items', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const invoice = await one<InvoiceRow>(c.env.DB, `SELECT * FROM invoices WHERE id = ?`, id);
      if (!invoice) return c.notFound();
      if (invoice.status !== 'draft') {
        return redirectWith(c, `/invoices/${id}`, 'An issued invoice cannot gain a line.', 'err');
      }

      const fees = await feeSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const description = f.text('description', { required: true, label: 'Description', max: 300 });
      const quantityMilli = parseQuantityToMilli(f.text('quantity', { required: true, label: 'Quantity', max: 10 }));
      const unitLabel = f.optional('unit_label', { max: 30 }) ?? 'item';
      const unitAmount = f.money('unit_amount', { required: true, label: 'Price per unit' });
      const kind = f.enum('kind', FEE_KINDS, { fallback: 'professional' })! as FeeKind;
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: fees.defaultTreatment })! as GstTreatment;
      const serviceItemId = f.optional('service_item_id', { max: 80 });
      if (!f.valid) return redirectWith(c, `/invoices/${id}`, Object.values(f.errors)[0]!, 'err');
      if (!quantityMilli) return redirectWith(c, `/invoices/${id}`, 'That quantity could not be read.', 'err');

      const rateBp = fees.gstRegistered ? fees.gstRateBp : 0;
      const amounts = computeLine({
        quantityMilli, unitAmountCents: unitAmount ?? 0,
        gstTreatment: fees.gstRegistered ? treatment : 'none', gstRateBp: rateBp,
      });
      const position = await one<{ n: number }>(
        c.env.DB, `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM invoice_items WHERE invoice_id = ?`, id);

      await run(
        c.env.DB,
        `INSERT INTO invoice_items (id, invoice_id, position, service_item_id, description, kind,
                unit_label, quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
                net_cents, gst_cents, gross_cents, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('ili'), id, position?.n ?? 0, serviceItemId, description, kind, unitLabel,
        quantityMilli, unitAmount ?? 0, fees.gstRegistered ? treatment : 'none', rateBp,
        amounts.netCents, amounts.gstCents, amounts.grossCents, nowIso(),
      );
      await refreshTotals(c.env, id);
      await auditFrom(c, { action: 'invoice.line_added', entityType: 'invoice', entityId: id,
        meta: { description, amount: amounts.grossCents } });
      return redirectWith(c, `/invoices/${id}`, 'Line added.');
    });

    r.post('/:id/items/:itemId/remove', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const itemId = c.req.param('itemId')!;
      try {
        await run(c.env.DB, `DELETE FROM invoice_items WHERE id = ? AND invoice_id = ?`, itemId, id);
      } catch {
        return redirectWith(c, `/invoices/${id}`, 'An issued invoice cannot lose a line.', 'err');
      }
      await refreshTotals(c.env, id);
      await auditFrom(c, { action: 'invoice.line_removed', entityType: 'invoice', entityId: id,
        meta: { itemId } });
      return redirectWith(c, `/invoices/${id}`, 'Line removed.');
    });

    // --- Issue, pay, void ---------------------------------------------------
    r.post('/:id/issue', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const issuedOn = f.date('issued_on', { label: 'Date of issue' }) ?? todayNz();
      const result = await issueInvoice(c.env, id, c.get('user')!.id, issuedOn);
      return redirectWith(c, `/invoices/${id}`, result.message, result.ok ? 'ok' : 'err');
    });

    r.post('/:id/payments', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const paidOn = f.date('paid_on', { label: 'Date received' }) ?? todayNz();
      const amount = f.money('amount', { required: true, label: 'Amount' });
      const method = f.enum('method', PAYMENT_METHODS, { fallback: 'bank' })! as PaymentMethod;
      const reference = f.optional('reference', { max: 120 });
      const note = f.optional('note', { max: 300 });
      if (!f.valid) return redirectWith(c, `/invoices/${id}`, Object.values(f.errors)[0]!, 'err');

      const result = await recordPayment(c.env, {
        invoiceId: id, paidOn, amountCents: amount ?? 0, method, reference, note,
        userId: c.get('user')!.id,
      });
      return redirectWith(c, `/invoices/${id}`, result.message, result.ok ? 'ok' : 'err');
    });

    r.post('/:id/void', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const reason = f.text('reason', { required: true, label: 'Reason', max: 300 });
      if (!f.valid) return redirectWith(c, `/invoices/${id}`, Object.values(f.errors)[0]!, 'err');
      const result = await voidInvoice(c.env, id, c.get('user')!.id, reason);
      return redirectWith(c, `/invoices/${id}`, result.message, result.ok ? 'ok' : 'err');
    });

    // --- The document -------------------------------------------------------
    r.get('/:id/print', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const invoice = await one<InvoiceRow & { client_name: string | null; case_ref: string | null }>(
        c.env.DB,
        `SELECT i.*, cl.full_name AS client_name, k.ref AS case_ref FROM invoices i
           LEFT JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN cases k ON k.id = i.case_id
          WHERE i.id = ?`,
        id,
      );
      if (!invoice) return c.notFound();

      const [practice, items, payments] = await Promise.all([
        practiceDetails(c.env), invoiceItems(c.env, id), paymentsFor(c.env, id),
      ]);
      const totals = totalsFor(items);
      const fees = items.filter((l) => l.kind === 'professional');
      const disbursements = items.filter((l) => l.kind !== 'professional');
      await auditFrom(c, { action: 'invoice.printed', entityType: 'invoice', entityId: id });

      const lineRows = (rows: typeof items) => rows.map((l) => html`
        <tr>
          <td>${l.description}</td>
          <td class="num">${formatQuantity(l.quantity_milli)} ${pluraliseUnit(l.unit_label, l.quantity_milli)}</td>
          <td class="num">${money(l.unit_amount_cents, invoice.currency)}</td>
          <td class="num">${money(l.net_cents, invoice.currency)}</td>
        </tr>`);

      return page(c, { title: `Invoice ${invoice.ref}`, bare: true }, html`
        <article class="quote-doc">
          <header class="quote-doc-head">
            <div>
              <h1>${practice.legalName}</h1>
              ${practice.adviserDetails ? html`<p class="prewrap small">${practice.adviserDetails}</p>` : ''}
              ${practice.postalAddress ? html`<p class="prewrap small">${practice.postalAddress}</p>` : ''}
              <p class="small">
                ${practice.contactEmail ? html`${practice.contactEmail}<br>` : ''}
                ${practice.contactPhone ? html`${practice.contactPhone}<br>` : ''}
                ${practice.gstNumber ? html`GST number ${practice.gstNumber}` : ''}
              </p>
            </div>
            <div class="quote-doc-ref">
              <h2>${totals.hasGst ? 'Tax invoice' : 'Invoice'}</h2>
              <dl class="quote-doc-meta">
                <dt>Invoice</dt><dd class="strong">${invoice.ref}</dd>
                <dt>Issued</dt><dd>${invoice.issued_on ? dateShort(invoice.issued_on) : 'draft'}</dd>
                <dt>Due</dt><dd class="strong">${invoice.due_on ? dateShort(invoice.due_on) : '—'}</dd>
                ${invoice.case_ref ? html`<dt>Matter</dt><dd>${invoice.case_ref}</dd>` : ''}
              </dl>
            </div>
          </header>

          ${invoice.status === 'draft' ? html`
            <p class="warn"><strong>Draft — not yet issued.</strong></p>` : ''}
          ${invoice.status === 'void' ? html`
            <p class="warn"><strong>VOID.</strong> ${invoice.void_reason ?? ''}</p>` : ''}

          <section>
            <h3>To</h3>
            <p class="strong">${invoice.client_name ?? '—'}</p>
          </section>

          ${invoice.description ? html`
            <section><h3>For</h3><p class="prewrap">${invoice.description}</p></section>` : ''}

          <table class="quote-doc-table">
            <thead>
              <tr><th>Description</th><th class="num">Quantity</th><th class="num">Unit price</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              ${fees.length ? html`
                <tr class="quote-doc-group"><td colspan="4">Professional fees</td></tr>
                ${lineRows(fees)}` : ''}
              ${disbursements.length ? html`
                <tr class="quote-doc-group"><td colspan="4">Disbursements — paid on your behalf</td></tr>
                ${lineRows(disbursements)}` : ''}
            </tbody>
            <tfoot>
              ${fees.length && disbursements.length ? html`
                <tr><td colspan="3">Professional fees</td>
                    <td class="num">${money(totals.feesNetCents, invoice.currency)}</td></tr>
                <tr><td colspan="3">Disbursements</td>
                    <td class="num">${money(totals.disbursementsNetCents, invoice.currency)}</td></tr>` : ''}
              <tr><td colspan="3">Subtotal</td>
                  <td class="num">${money(totals.subtotalNetCents, invoice.currency)}</td></tr>
              ${totals.hasGst
                ? html`<tr><td colspan="3">GST</td>
                           <td class="num">${money(totals.gstCents, invoice.currency)}</td></tr>`
                : html`<tr><td colspan="4" class="small muted">No GST applies to this invoice.</td></tr>`}
              <tr class="totals-row">
                <td colspan="3" class="strong">Total</td>
                <td class="num strong">${money(totals.totalCents, invoice.currency)}</td></tr>
              ${invoice.paid_cents ? html`
                <tr><td colspan="3">Received</td>
                    <td class="num">${money(invoice.paid_cents, invoice.currency)}</td></tr>
                <tr class="totals-row"><td colspan="3" class="strong">Now due</td>
                    <td class="num strong">${money(outstanding(invoice), invoice.currency)}</td></tr>` : ''}
            </tfoot>
          </table>

          ${payments.length ? html`
            <section>
              <h3>Payments received</h3>
              <table class="quote-doc-table">
                <thead><tr><th>Date</th><th>How</th><th class="num">Amount</th></tr></thead>
                <tbody>${payments.map((p) => html`
                  <tr><td>${dateShort(p.paid_on)}</td>
                      <td>${PAYMENT_METHOD_LABELS[p.method] ?? p.method}${p.reference ? ` · ${p.reference}` : ''}</td>
                      <td class="num">${money(p.amount_cents, invoice.currency)}</td></tr>`)}
                </tbody>
              </table>
            </section>` : ''}

          ${practice.bankAccountNumber ? html`
          <section>
            <h3>Payment</h3>
            <dl class="kv quote-doc-bank">
              ${practice.bankAccountHolder ? html`<dt>Account holder</dt><dd>${practice.bankAccountHolder}</dd>` : ''}
              ${practice.bankName ? html`<dt>Bank</dt><dd>${practice.bankName}</dd>` : ''}
              <dt>Account</dt><dd><strong>${practice.bankAccountNumber}</strong></dd>
            </dl>
            <p class="small muted">Please quote <strong>${invoice.ref}</strong> as the reference. If
               you receive an email appearing to change these details, telephone this office on the
               number above before paying anything.</p>
          </section>` : html`
          <section>
            <h3>Payment</h3>
            <p class="small muted">Bank account details are set under Settings → Practice and will
               print here once they are entered.</p>
          </section>`}

          <footer class="quote-doc-foot no-print">
            <button class="btn btn-primary" data-print type="button">Print this invoice</button>
            <a class="btn btn-secondary" href="/invoices/${invoice.id}">Back to the invoice</a>
          </footer>
        </article>`);
    });

    app.route('/invoices', r);
  },
};
