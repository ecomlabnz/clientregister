/**
 * Module: quotes.
 *
 * What was quoted, to whom, when, and what came of it. A quote is a proposal;
 * once accepted it can be pushed into the case's fee lines in one action so the
 * money is recorded exactly once.
 */

import { Hono } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import { all, count, nextRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, field, optionsFrom, pageHeader, select, stamp, statusTone, table,
} from '../../ui/components';
import { dateInputValue, dateShort, money } from '../../ui/format';
import { QUOTE_STATUS_LABELS, QUOTE_STATUSES, type QuoteStatus } from '../../domain';
import { clientOptions } from '../../core/lookups';
import { addEntry, listEntries } from '../../core/timeline';
import { can } from '../../core/rbac';
import {
  computeGst, FEE_KIND_LABELS, FEE_KINDS, GST_TREATMENT_LABELS, GST_TREATMENTS,
  type FeeKind, type GstTreatment,
} from '../../core/fees';
import {
  computeLine, formatQuantity, parseQuantityToMilli, pluraliseUnit, summariseQuote, validUntil,
  type QuoteTotals,
} from '../../core/quotes';
import { asInteger, readSettings, type SettingsGroup } from '../../core/settings';
import { feeSettings } from '../fees';
import { practiceDetails } from '../../core/practice';
import { invoiceFromQuote } from '../../core/invoices';
import { renderEmailHtml } from '../../core/richtext';
import { mailConfigured } from '../../mail/provider';
import { flushQueue, queueEmail } from '../../mail/queue';

export const QUOTE_SETTINGS: SettingsGroup = {
  id: 'quotes',
  title: 'Quotes',
  description: 'How quotes are put together and how long they stand.',
  order: 35,
  settings: [
    { key: 'quotes.validity_days', type: 'integer', label: 'A quote stands for (days)', default: '7',
      min: 1, max: 365,
      help: 'Counted inclusive of the day it is issued — issued on the 28th, seven days means it is good through the 3rd. The quote shows the date, never a number of days, so the client does not have to work it out.' },
    { key: 'quotes.capacity_note', type: 'text', label: 'Capacity wording', maxLength: 400,
      default: 'This quote is subject to our capacity to accept the work at the time you accept it.',
      help: 'Printed on every quote beneath the total. Leave blank to omit it.' },
    { key: 'quotes.payment_terms', type: 'text', label: 'Payment wording', maxLength: 400,
      default: 'Fees are payable in advance into the practice trust account. Disbursements are payable as they fall due.',
      help: 'Printed on every quote. Leave blank to omit it.' },
    { key: 'quotes.default_unit_label', type: 'string', label: 'Default unit', default: 'item', maxLength: 30,
      help: 'What one of something is called when a line does not say otherwise.' },
  ],
};

export interface QuoteSettings {
  validityDays: number;
  capacityNote: string;
  paymentTerms: string;
  defaultUnitLabel: string;
}

export async function quoteSettings(env: Env): Promise<QuoteSettings> {
  const values = await readSettings(env, QUOTE_SETTINGS.settings);
  return {
    validityDays: asInteger(values['quotes.validity_days'], 7),
    capacityNote: values['quotes.capacity_note'] ?? '',
    paymentTerms: values['quotes.payment_terms'] ?? '',
    defaultUnitLabel: values['quotes.default_unit_label'] || 'item',
  };
}

export interface ServiceItemRow {
  id: string; name: string; description: string | null; kind: FeeKind;
  unit_label: string; unit_amount_cents: number; gst_treatment: GstTreatment;
  active: number; sort_order: number;
}

export interface QuoteItemRow {
  id: string; quote_id: string; position: number; service_item_id: string | null;
  description: string; kind: FeeKind; unit_label: string; quantity_milli: number;
  unit_amount_cents: number; gst_treatment: GstTreatment; gst_rate_bp: number;
  net_cents: number; gst_cents: number; gross_cents: number;
}

export async function quoteLines(env: Env, quoteId: string): Promise<QuoteItemRow[]> {
  return all<QuoteItemRow>(
    env.DB,
    'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY position, created_at',
    quoteId,
  );
}

export interface QuoteStageRow {
  id: string; quote_id: string; position: number; label: string; description: string;
  amount_cents: number; gst_treatment: GstTreatment; gst_rate_bp: number;
  net_cents: number; gst_cents: number; gross_cents: number;
}

export async function quoteStages(env: Env, quoteId: string): Promise<QuoteStageRow[]> {
  return all<QuoteStageRow>(
    env.DB, 'SELECT * FROM quote_stages WHERE quote_id = ? ORDER BY position, created_at', quoteId);
}

export async function catalogue(env: Env, includeRetired = false): Promise<ServiceItemRow[]> {
  return all<ServiceItemRow>(
    env.DB,
    `SELECT * FROM service_items ${includeRetired ? '' : 'WHERE active = 1'}
      ORDER BY sort_order, name`,
  );
}

/**
 * Recalculate the header figures from the lines.
 *
 * `quotes.amount_cents`, `gst_cents` and `disbursements_cents` remain the
 * columns every list, dashboard and conversion-to-fees already reads. Rather
 * than change all of that, the lines are the truth and these are kept in step
 * with them after every edit — one place that writes them, so they cannot
 * disagree with the itemisation a client was sent.
 */
export async function refreshQuoteTotals(env: Env, quoteId: string): Promise<QuoteTotals> {
  const lines = await quoteLines(env, quoteId);
  const totals = summariseQuote(lines.map((l) => ({
    kind: l.kind, lineAmountCents: l.unit_amount_cents, netCents: l.net_cents,
    gstCents: l.gst_cents, grossCents: l.gross_cents,
  })));
  await run(
    env.DB,
    `UPDATE quotes SET amount_cents = ?, gst_cents = ?, disbursements_cents = ?, updated_at = ? WHERE id = ?`,
    totals.feesNetCents, totals.gstCents, totals.disbursementsNetCents, nowIso(), quoteId,
  );
  return totals;
}

export interface QuoteRow {
  id: string; ref: string; client_id: string | null; case_id: string | null; inquiry_id: string | null;
  description: string; amount_cents: number; gst_cents: number; disbursements_cents: number;
  currency: string; status: QuoteStatus; valid_until: string | null; sent_at: string | null;
  responded_at: string | null; notes: string | null; created_at: string; updated_at: string;
  issued_on: string | null; validity_days: number | null; stage_note: string | null;
}

function quoteTotal(q: Pick<QuoteRow, 'amount_cents' | 'gst_cents' | 'disbursements_cents'>): number {
  return q.amount_cents + q.gst_cents + q.disbursements_cents;
}

/**
 * A first draft of the covering email, for editing rather than sending as-is.
 * It states the figures and points at the terms, which are the two things a
 * quote must not leave ambiguous.
 */
function defaultQuoteEmail(
  q: QuoteRow & { client_name: string | null },
  practice: { legalName: string; termsLabel: string; termsUrl: string; contactEmail: string; contactPhone: string },
  items: QuoteItemRow[] = [],
  capacityNote = '',
): string {
  const totals = summariseQuote(items.map((l) => ({
    kind: l.kind, lineAmountCents: l.unit_amount_cents,
    netCents: l.net_cents, gstCents: l.gst_cents, grossCents: l.gross_cents,
  })));

  // Padded so the figures line up in a plain-text mail client, which is where a
  // quote is most often read. A description longer than the column takes its own
  // line rather than being cut off — a truncated description on a fee quote is
  // worse than an untidy one.
  const WIDTH = 58;
  const row = (label: string, amount: number) => {
    const figure = money(amount, q.currency).padStart(12);
    return label.length <= WIDTH ? `${label.padEnd(WIDTH)}${figure}` : `${label}\n${''.padEnd(WIDTH)}${figure}`;
  };
  const itemRow = (l: QuoteItemRow) => {
    const qty = l.quantity_milli === 1000
      ? ''
      : ` (${formatQuantity(l.quantity_milli)} ${pluraliseUnit(l.unit_label, l.quantity_milli)} × ${money(l.unit_amount_cents, q.currency)})`;
    return row(`  ${l.description}${qty}`, l.net_cents);
  };

  const fees = items.filter((l) => l.kind === 'professional');
  const disbursements = items.filter((l) => l.kind !== 'professional');

  const lines = [
    `Dear ${q.client_name ?? 'Sir or Madam'},`,
    '',
    'Thank you for your enquiry. I am pleased to quote for the following work:',
    '',
    q.description,
    '',
  ];

  if (fees.length) lines.push('Professional fees', ...fees.map(itemRow), '');
  if (disbursements.length) {
    lines.push('Disbursements — paid on your behalf', ...disbursements.map(itemRow), '');
  }
  lines.push(row('Subtotal', totals.subtotalNetCents));
  if (totals.hasGst) lines.push(row('GST', totals.gstCents));
  lines.push(row('Total payable', totals.totalCents), '');

  if (q.valid_until) lines.push(`This quote is valid until ${dateShort(q.valid_until)}.`, '');
  if (capacityNote) lines.push(capacityNote, '');
  if (disbursements.length) {
    lines.push(
      'Disbursements are amounts paid to third parties on your behalf and are passed',
      'on to you without margin.',
      '',
    );
  }

  if (practice.termsUrl) {
    lines.push(
      `This quote is given on the ${practice.termsLabel}, which you may download here:`,
      practice.termsUrl,
      '',
      'Please read those terms before accepting this quote.',
      '',
    );
  }

  lines.push(
    'Please let me know if you would like to proceed, or if anything above needs clarifying.',
    '',
    'Kind regards,',
    practice.legalName,
  );
  if (practice.contactEmail) lines.push(practice.contactEmail);
  if (practice.contactPhone) lines.push(practice.contactPhone);

  return lines.join('\n');
}

export const quotesModule: AppModule = {
  name: 'quotes',
  title: 'Quotes',
  basePaths: ['/quotes'],
  nav: [{ href: '/quotes', label: 'Quotes', permission: 'register:read', order: 60, group: 'Money' }],
  settings: [QUOTE_SETTINGS],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const q0 = (c.req.query('q') ?? '').trim();
      // Four ways of looking at the pipeline. "Live" is the one that matters
      // day to day: what is out and what has been agreed but not yet billed.
      const view = c.req.query('view') ?? 'live';
      const status = c.req.query('status') ?? '';
      const conds: string[] = [];
      const params: unknown[] = [];
      if ((QUOTE_STATUSES as readonly string[]).includes(status)) { conds.push('q.status = ?'); params.push(status); }
      else if (view === 'live') conds.push(`q.status IN ('draft','sent')`);
      else if (view === 'accepted') conds.push(`q.status = 'accepted'`);
      else if (view === 'closed') conds.push(`q.status IN ('declined','expired','withdrawn')`);
      if (q0) {
        conds.push('(q.ref LIKE ?1 OR q.description LIKE ?1 OR cl.full_name LIKE ?1)');
        params.push(`%${q0}%`);
      }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await all<QuoteRow & { client_name: string | null; case_ref: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name, k.ref AS case_ref FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id
           LEFT JOIN cases k ON k.id = q.case_id
           ${whereSql} ORDER BY q.created_at DESC LIMIT 200`,
        ...params,
      );

      const accepted = rows.filter((q) => q.status === 'accepted');
      const outstanding = rows.filter((q) => q.status === 'sent');

      const counts = await one<{ live: number; accepted: number; closed: number; total: number }>(
        c.env.DB,
        `SELECT SUM(status IN ('draft','sent')) AS live,
                SUM(status = 'accepted') AS accepted,
                SUM(status IN ('declined','expired','withdrawn')) AS closed,
                COUNT(*) AS total FROM quotes`,
      );
      const views = [
        { id: 'live', label: 'Live', count: counts?.live ?? 0 },
        { id: 'accepted', label: 'Accepted', count: counts?.accepted ?? 0 },
        { id: 'closed', label: 'Closed', count: counts?.closed ?? 0 },
        { id: 'all', label: 'All', count: counts?.total ?? 0 },
      ];

      return page(c, { title: 'Quotes', active: '/quotes' }, html`
        ${pageHeader('Quotes', 'Fees proposed, and how they landed.',
          can(c.get('user'), 'quote:write') ? html`<a class="btn btn-primary" href="/quotes/new">New quote</a>` : undefined)}
        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Awaiting reply</span><span class="stat-value">${outstanding.length}</span></div>
          <div class="stat"><span class="stat-label">Value out</span><span class="stat-value">${money(outstanding.reduce((s, q) => s + quoteTotal(q), 0))}</span></div>
          <div class="stat"><span class="stat-label">Accepted</span><span class="stat-value">${money(accepted.reduce((s, q) => s + quoteTotal(q), 0))}</span></div>
        </div>
        <nav class="tabs">
          ${views.map((v) => html`
            <a class="${v.id === view && !status ? 'tab current' : 'tab'}"
               href="/quotes?view=${v.id}">${v.label} <span class="muted">${v.count}</span></a>`)}
        </nav>
        <form method="get" action="/quotes" class="filters" data-live-search>
          <input type="hidden" name="view" value="${view}">
          <input type="search" name="q" value="${q0}" placeholder="Search reference, description or client">
          <select name="status"><option value="">Any status in this view</option>
            ${QUOTE_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${QUOTE_STATUS_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-secondary js-hide" type="submit">Filter</button>
        </form>
        <div data-live-results>
        ${table([
          { label: 'Reference', width: '12', hideOn: 'sm' },
          { label: 'Client', width: '18', hideOn: 'sm' },
          { label: 'Description', width: '32' },
          { label: 'Total', width: '14', align: 'right' },
          { label: 'Valid until', width: '12' },
          { label: 'Status', width: '12', hideOn: 'sm' },
        ], rows.map((row) => html`
          <tr>
            <td class="col-sm-hide"><a href="/quotes/${row.id}"><code>${row.ref}</code></a></td>
            <td class="small col-sm-hide">${row.client_id ? html`<a href="/clients/${row.client_id}">${row.client_name}</a>` : '—'}</td>
            <td><a class="clamp-2" href="/quotes/${row.id}">${row.description}</a>
                ${row.case_ref ? html`<div class="muted small">${row.case_ref}</div>` : ''}
                <div class="row-meta show-sm">
                  <code>${row.ref}</code>
                  ${row.client_name ? html`<span class="muted">${row.client_name}</span>` : ''}
                  ${badge(QUOTE_STATUS_LABELS[row.status], statusTone(row.status))}
                </div></td>
            <td class="num strong">${money(quoteTotal(row), row.currency)}</td>
            <td class="small">${dateShort(row.valid_until)}</td>
            <td class="col-sm-hide">${badge(QUOTE_STATUS_LABELS[row.status], statusTone(row.status))}</td>
          </tr>`), { sticky: true, fixed: true, empty: 'No quotes in this view.' })}
        </div>`);
    });

    r.get('/new', requirePermission('quote:write'), async (c) => {
      const csrf = c.get('session')!.csrf;
      const [clients, qs] = await Promise.all([clientOptions(c.env), quoteSettings(c.env)]);
      const presetClient = c.req.query('client_id') ?? '';
      const presetCase = c.req.query('case_id') ?? '';
      const presetInquiry = c.req.query('inquiry_id') ?? '';
      const today = nowIso().slice(0, 10);

      return page(c, { title: 'New quote', active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: 'New' }])}
        ${pageHeader('New quote', 'Start with who it is for and what it covers. The items go on next.')}
        <form method="post" action="/quotes" class="form-grid">
          ${csrfField(csrf)}
          <input type="hidden" name="case_id" value="${presetCase}">
          <input type="hidden" name="inquiry_id" value="${presetInquiry}">
          <div class="form-section">
            <h3>Who and what</h3>
            ${select({ label: 'Client', name: 'client_id', value: presetClient, options: clients, includeBlank: 'No client yet' })}
            ${field({ label: 'Scope', name: 'description', required: true, maxlength: 500,
                      placeholder: 'e.g. Partnership work visa — preparation and lodgement',
                      hint: 'One line describing the work. The itemisation comes next.' })}
          </div>
          <div class="form-section">
            <h3>Validity</h3>
            ${field({ label: 'Date of issue', name: 'issued_on', type: 'date', value: today })}
            ${field({ label: 'Stands for (days)', name: 'validity_days', value: String(qs.validityDays), maxlength: 3,
                      hint: `Counted inclusive of the day of issue, so ${qs.validityDays} days from ${today} means it is good through ${validUntil(today, qs.validityDays)}. The quote prints that date, not a number of days.` })}
          </div>
          <div class="form-section">
            <h3>Notes</h3>
            ${field({ label: 'Internal notes', name: 'notes', type: 'textarea', rows: 4, maxlength: 4000,
                      hint: 'For the file. Never printed on the quote.' })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Create and add items</button>
            <a class="btn btn-secondary" href="/quotes">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/', requirePermission('quote:write'), async (c) => {
      const user = c.get('user')!;
      const qs = await quoteSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const clientId = f.optional('client_id', { max: 60 });
      const caseId = f.optional('case_id', { max: 60 });
      const inquiryId = f.optional('inquiry_id', { max: 60 });
      const description = f.text('description', { required: true, label: 'Scope', max: 500 });
      const issuedOn = f.date('issued_on') ?? nowIso().slice(0, 10);
      const days = f.int('validity_days', { min: 1, max: 365 }) ?? qs.validityDays;
      const notes = f.optional('notes', { max: 4000 });
      if (!f.valid) return redirectWith(c, '/quotes/new', Object.values(f.errors)[0] ?? 'Invalid quote.', 'err');

      // The date is worked out and stored now. A quote that says "valid for
      // 7 days" makes the reader do arithmetic from a date they have to find
      // first, and they will do it differently from you.
      const until = validUntil(issuedOn, days);

      const id = newId('quo');
      const ref = await nextRef(c.env.DB, 'quote', 'Q');
      await run(
        c.env.DB,
        `INSERT INTO quotes (id, ref, client_id, case_id, inquiry_id, description, amount_cents, gst_cents,
            disbursements_cents, currency, status, issued_on, validity_days, valid_until, notes,
            created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?, 0, 0, 0, 'NZD', 'draft', ?,?,?,?,?,?,?)`,
        id, ref, clientId || null, caseId || null, inquiryId || null, description,
        issuedOn, days, until, notes, nowIso(), nowIso(), user.id,
      );
      await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'system',
        body: `Quote ${ref} started — valid until ${until}.`, createdBy: user.id });
      if (clientId) {
        await addEntry(c.env, { entityType: 'client', entityId: clientId, kind: 'system',
          body: `Quote ${ref} drafted: ${description}.`, createdBy: user.id });
      }
      if (inquiryId) {
        await run(c.env.DB, `UPDATE inquiries SET status = 'quoted', updated_at = ? WHERE id = ? AND status IN ('new','triaged','responded')`, nowIso(), inquiryId);
      }
      await auditFrom(c, { action: 'quote.created', entityType: 'quote', entityId: id, meta: { ref } });
      return redirectWith(c, `/quotes/${id}`, `Quote ${ref} started. Add the items below.`);
    });

    // Registered before the ':id' routes below: Hono matches in the order
    // routes are added, so '/catalogue' would otherwise be read as a quote id.
    // --- The catalogue behind the description dropdown ----------------------

    r.get('/catalogue', requirePermission('quote:write'), async (c) => {
      const items = await catalogue(c.env, true);
      const csrf = c.get('session')!.csrf;
      const fees = await feeSettings(c.env);
      const qs = await quoteSettings(c.env);
      const editing = c.req.query('edit');
      const item = editing ? items.find((i) => i.id === editing) ?? null : null;

      return page(c, { title: 'Standard items', active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: 'Standard items' }])}
        ${pageHeader('Standard items',
          'The things this practice quotes for, and what they usually cost. Choosing one on a quote fills the line in; the quote then keeps its own copy, so changing a price here never alters a quote already sent.')}

        ${table(['Item', 'Type', 'Unit', 'Usual price', 'GST', ''], items.map((it) => html`
          <tr class="${it.active ? '' : 'row-muted'}">
            <td><span class="strong">${it.name}</span>
              ${it.description ? html`<div class="muted small">${it.description}</div>` : ''}</td>
            <td class="small">${FEE_KIND_LABELS[it.kind]}</td>
            <td class="small">${it.unit_label}</td>
            <td class="num">${it.unit_amount_cents ? money(it.unit_amount_cents) : html`<span class="muted">not set</span>`}</td>
            <td class="small">${GST_TREATMENT_LABELS[it.gst_treatment]}</td>
            <td>
              <a class="btn btn-small btn-secondary" href="/quotes/catalogue?edit=${it.id}">Edit</a>
              ${actionButton(`/quotes/catalogue/${it.id}/toggle`, csrf, it.active ? 'Retire' : 'Restore',
                { className: 'btn btn-small btn-link' })}
            </td>
          </tr>`))}

        ${card(item ? `Edit “${item.name}”` : 'Add a standard item', html`
          <form method="post" action="${item ? `/quotes/catalogue/${item.id}` : '/quotes/catalogue'}" class="form-grid">
            ${csrfField(csrf)}
            <div class="form-section">
              ${field({ label: 'Name', name: 'name', required: true, maxlength: 120, value: item?.name,
                        hint: 'What appears in the dropdown.' })}
              ${field({ label: 'Description', name: 'description', type: 'textarea', rows: 2, maxlength: 300,
                        value: item?.description,
                        hint: 'What is written on the quote line. Left blank, the name is used.' })}
            </div>
            <div class="form-section">
              ${select({ label: 'Type', name: 'kind', value: item?.kind ?? 'professional', includeBlank: false,
                         options: optionsFrom(FEE_KINDS, FEE_KIND_LABELS),
                         hint: 'Only professional fees are apportioned in the revenue split. Disbursements are passed through whole.' })}
              ${field({ label: 'Unit', name: 'unit_label', maxlength: 30,
                        value: item?.unit_label ?? qs.defaultUnitLabel,
                        hint: 'hour, application, response, item…' })}
              ${field({ label: 'Usual price per unit', name: 'unit_amount',
                        value: item ? (item.unit_amount_cents / 100).toFixed(2) : '',
                        placeholder: '0.00', hint: 'Leave blank if it varies every time.' })}
              ${select({ label: 'GST', name: 'gst_treatment',
                         value: item?.gst_treatment ?? (fees.gstRegistered ? fees.defaultTreatment : 'none'),
                         includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
            </div>
            <div class="form-actions">
              <button class="btn btn-primary" type="submit">${item ? 'Save changes' : 'Add item'}</button>
              ${item ? html`<a class="btn btn-secondary" href="/quotes/catalogue">Cancel</a>` : ''}
            </div>
          </form>`)}`);
    });

    r.post('/catalogue', requirePermission('quote:write'), async (c) => {
      const f = new FormReader(await c.req.formData());
      const fields = readCatalogueForm(f);
      if (!f.valid) return redirectWith(c, '/quotes/catalogue', Object.values(f.errors)[0]!, 'err');
      const now = nowIso();
      try {
        await run(
          c.env.DB,
          `INSERT INTO service_items (id, name, description, kind, unit_label, unit_amount_cents,
              gst_treatment, active, sort_order, created_at, updated_at, created_by)
           VALUES (?,?,?,?,?,?,?,1,100,?,?,?)`,
          newId('svc'), fields.name, fields.description, fields.kind, fields.unitLabel,
          fields.unitAmount, fields.treatment, now, now, c.get('user')!.id,
        );
      } catch {
        // The unique index on the name is what refuses a duplicate; saying so
        // is more use than the generic error page.
        return redirectWith(c, '/quotes/catalogue', `There is already an item called “${fields.name}”.`, 'err');
      }
      await auditFrom(c, { action: 'quote.catalogue_added', entityType: 'service_item', meta: { name: fields.name } });
      return redirectWith(c, '/quotes/catalogue', `Added “${fields.name}”.`);
    });

    r.post('/catalogue/:itemId', requirePermission('quote:write'), async (c) => {
      const itemId = c.req.param('itemId')!;
      const f = new FormReader(await c.req.formData());
      const fields = readCatalogueForm(f);
      if (!f.valid) return redirectWith(c, `/quotes/catalogue?edit=${itemId}`, Object.values(f.errors)[0]!, 'err');
      await run(
        c.env.DB,
        `UPDATE service_items SET name = ?, description = ?, kind = ?, unit_label = ?,
            unit_amount_cents = ?, gst_treatment = ?, updated_at = ? WHERE id = ?`,
        fields.name, fields.description, fields.kind, fields.unitLabel,
        fields.unitAmount, fields.treatment, nowIso(), itemId,
      );
      await auditFrom(c, { action: 'quote.catalogue_updated', entityType: 'service_item', entityId: itemId,
        meta: { name: fields.name } });
      return redirectWith(c, '/quotes/catalogue', 'Saved.');
    });

    r.post('/catalogue/:itemId/toggle', requirePermission('quote:write'), async (c) => {
      const itemId = c.req.param('itemId')!;
      // Retired rather than deleted: quotes that used it keep their own copy of
      // the wording and the price, and reporting can still resolve the link.
      await run(c.env.DB,
        'UPDATE service_items SET active = 1 - active, updated_at = ? WHERE id = ?', nowIso(), itemId);
      await auditFrom(c, { action: 'quote.catalogue_toggled', entityType: 'service_item', entityId: itemId });
      return redirectWith(c, '/quotes/catalogue', 'Updated.');
    });

    r.get('/:id', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow & { client_name: string | null; case_ref: string | null; inquiry_ref: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name, k.ref AS case_ref, i.ref AS inquiry_ref FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id
           LEFT JOIN cases k ON k.id = q.case_id
           LEFT JOIN inquiries i ON i.id = q.inquiry_id
          WHERE q.id = ?`,
        id,
      );
      if (!q) return c.notFound();

      const [entries, terms, lines, items, fees, qSettings, stages, quoteInvoices] = await Promise.all([
        listEntries(c.env, 'quote', id),
        practiceDetails(c.env),
        quoteLines(c.env, id),
        catalogue(c.env),
        feeSettings(c.env),
        quoteSettings(c.env),
        quoteStages(c.env, id),
        all<{ id: string; ref: string; status: string; gross_cents: number }>(
          c.env.DB, `SELECT id, ref, status, gross_cents FROM invoices WHERE quote_id = ? ORDER BY created_at`, id),
      ]);
      const stageTotal = stages.reduce((sum, s) => sum + s.gross_cents, 0);
      const csrf = c.get('session')!.csrf;
      const writable = can(c.get('user'), 'quote:write');
      const totals = summariseQuote(lines.map((l) => ({
        kind: l.kind, lineAmountCents: l.unit_amount_cents,
        netCents: l.net_cents, gstCents: l.gst_cents, grossCents: l.gross_cents,
      })));

      return page(c, { title: q.ref, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: q.ref }])}
        ${pageHeader(q.description, `${q.ref} · ${QUOTE_STATUS_LABELS[q.status]}`, html`
          <a class="btn btn-secondary" href="/quotes/${q.id}/print" target="_blank" rel="noopener">Print</a>
          ${writable ? html`
            <a class="btn btn-secondary" href="/quotes/${q.id}/edit">Edit</a>
            <a class="btn btn-primary" href="/quotes/${q.id}/email">Email to client</a>
            ${q.status !== 'withdrawn' && q.status !== 'accepted'
              ? actionButton(`/quotes/${q.id}/status`, csrf, 'Cancel quote',
                  { className: 'btn btn-danger', fields: { status: 'withdrawn' },
                    confirm: `Cancel quote ${q.ref}? It stays on the file, marked withdrawn.` })
              : ''}` : ''}`)}

        <div class="cols">
          <div class="col-main">
            ${terms.termsUrl
              ? html`<div class="alert alert-ok">
                       This quote is given on the
                       <a href="${terms.termsUrl}" target="_blank" rel="noopener noreferrer">${terms.termsLabel}</a>,
                       which the client may download from that link.
                     </div>`
              : ''}

            ${card('Items', html`
              ${lines.length === 0
                ? emptyState('No lines yet. Add the first one below.')
                : table(['Description', 'Qty', 'Unit', 'Amount', 'GST', ''], [
                    ...lines.map((l) => html`
                      <tr>
                        <td>
                          <span class="strong">${l.description}</span>
                          <div class="muted small">${FEE_KIND_LABELS[l.kind]}</div>
                        </td>
                        <td class="num">${formatQuantity(l.quantity_milli)}
                          <div class="muted small">${pluraliseUnit(l.unit_label, l.quantity_milli)}</div></td>
                        <td class="num">${money(l.unit_amount_cents, q.currency)}</td>
                        <td class="num strong">${money(l.net_cents, q.currency)}</td>
                        <td class="num">${l.gst_cents ? money(l.gst_cents, q.currency)
                          : html`<span class="muted">—</span>`}</td>
                        <td>${writable
                          ? actionButton(`/quotes/${q.id}/items/${l.id}/remove`, csrf, 'Remove',
                              { className: 'btn btn-link-danger btn-small',
                                confirm: `Remove “${l.description}” from this quote?` })
                          : ''}</td>
                      </tr>`),
                    html`<tr class="totals-row">
                      <td colspan="3">Professional fees</td>
                      <td class="num strong">${money(totals.feesNetCents, q.currency)}</td><td colspan="2"></td></tr>`,
                    ...(totals.disbursementsNetCents !== 0 ? [html`<tr class="totals-row">
                      <td colspan="3">Disbursements</td>
                      <td class="num strong">${money(totals.disbursementsNetCents, q.currency)}</td><td colspan="2"></td></tr>`] : []),
                    html`<tr class="totals-row">
                      <td colspan="3">Subtotal</td>
                      <td class="num strong">${money(totals.subtotalNetCents, q.currency)}</td><td colspan="2"></td></tr>`,
                    ...(totals.hasGst ? [html`<tr class="totals-row">
                      <td colspan="3">GST</td>
                      <td class="num strong">${money(totals.gstCents, q.currency)}</td><td colspan="2"></td></tr>`] : []),
                    html`<tr class="totals-row">
                      <td colspan="3" class="strong">Total payable</td>
                      <td class="num strong">${money(totals.totalCents, q.currency)}</td><td colspan="2"></td></tr>`,
                  ])}

              ${writable && lines.length > 0 ? html`
                <details class="add-block">
                  <summary>Edit the lines</summary>
                  <p class="hint mb">Change anything on any line, reorder them, or tick to remove.
                     Saving recalculates the totals and rewrites the quote.</p>
                  <form method="post" action="/quotes/${q.id}/items">
                    ${csrfField(csrf)}
                    <input type="hidden" name="_action" value="save">
                    <div class="table-wrap">
                      <table class="edit-table">
                        <thead><tr>
                          <th>#</th><th>Description</th><th>Qty</th><th>Unit</th>
                          <th>Price per unit</th><th>Type</th><th>GST</th><th></th>
                        </tr></thead>
                        <tbody>
                          ${lines.map((l, i) => html`
                            <tr>
                              <td><input name="position_${l.id}" value="${i + 1}" size="2" inputmode="numeric"
                                         aria-label="Order"></td>
                              <td><input name="description_${l.id}" value="${l.description}" maxlength="300"
                                         required aria-label="Description"></td>
                              <td><input name="quantity_${l.id}" value="${formatQuantity(l.quantity_milli)}"
                                         size="4" inputmode="decimal" required aria-label="Quantity"></td>
                              <td><input name="unit_${l.id}" value="${l.unit_label}" size="8" maxlength="30"
                                         aria-label="Unit"></td>
                              <td><input name="amount_${l.id}" value="${(l.unit_amount_cents / 100).toFixed(2)}"
                                         size="8" inputmode="decimal" required aria-label="Price per unit"></td>
                              <td><select name="kind_${l.id}" aria-label="Type">
                                ${FEE_KINDS.map((k) => html`<option value="${k}" ${k === l.kind ? raw('selected') : ''}>${FEE_KIND_LABELS[k]}</option>`)}
                              </select></td>
                              <td><select name="gst_${l.id}" aria-label="GST">
                                ${GST_TREATMENTS.map((g) => html`<option value="${g}" ${g === l.gst_treatment ? raw('selected') : ''}>${GST_TREATMENT_LABELS[g]}</option>`)}
                              </select></td>
                              <td><label class="small"><input type="checkbox" name="remove_${l.id}"> remove</label></td>
                            </tr>`)}
                        </tbody>
                      </table>
                    </div>
                    <button class="btn btn-primary" type="submit">Save the lines</button>
                  </form>
                </details>` : ''}

              ${writable ? html`
                <details class="add-block" ${lines.length === 0 ? raw('open') : ''}>
                  <summary>Add a line</summary>
                  <p class="hint mb">Choosing something from the catalogue fills the rest of the line
                     in, and you can still change any of it. Manage that list under
                     <a href="/quotes/catalogue">standard items</a>.</p>
                  <form method="post" action="/quotes/${q.id}/items" class="row-form js-quote-line">
                    ${csrfField(csrf)}
                    <div class="field">
                      <label for="f_service_item_id">From the catalogue</label>
                      <select id="f_service_item_id" name="service_item_id" class="js-catalogue">
                        <option value="">— type it in below —</option>
                        ${items.map((it) => html`<option value="${it.id}"
                            data-description="${it.description || it.name}"
                            data-kind="${it.kind}"
                            data-unit="${it.unit_label}"
                            data-amount="${(it.unit_amount_cents / 100).toFixed(2)}"
                            data-gst="${it.gst_treatment}">${it.name}${it.unit_amount_cents
                              ? ` — ${money(it.unit_amount_cents, q.currency)}/${it.unit_label}` : ''}</option>`)}
                      </select>
                    </div>
                    ${field({ label: 'Description', name: 'description', required: true, maxlength: 300 })}
                    ${field({ label: 'Quantity', name: 'quantity', value: '1', required: true, maxlength: 10 })}
                    ${field({ label: 'Unit', name: 'unit_label', value: qSettings.defaultUnitLabel, maxlength: 30 })}
                    ${field({ label: 'Price per unit', name: 'unit_amount', required: true, placeholder: '0.00' })}
                    ${select({ label: 'Type', name: 'kind', value: 'professional', includeBlank: false,
                               options: optionsFrom(FEE_KINDS, FEE_KIND_LABELS) })}
                    ${select({ label: 'GST', name: 'gst_treatment',
                               value: fees.gstRegistered ? fees.defaultTreatment : 'none',
                               includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS),
                               hint: 'Disbursements are normally “No GST” — an INZ fee is passed through as it stands.' })}
                    <button class="btn btn-primary" type="submit">Add line</button>
                  </form>
                </details>` : ''}`)}

            ${card('Payment stages', html`
              <p class="hint mb">When each part falls due. Kept apart from the items above, because
                 the two do not line up: one piece of work can be split across a deposit and a
                 balance, and one stage can gather several fees into a single payment.</p>
              ${stages.length === 0
                ? emptyState('No stages set out. Payment terms alone will be printed.')
                : table(['Stage', 'Description', 'Amount'], [
                    ...stages.map((s) => html`
                      <tr>
                        <td class="small strong">${s.label || '—'}</td>
                        <td>${s.description}</td>
                        <td class="num">${money(s.net_cents, q.currency)}
                          ${s.gst_treatment === 'exclusive' && s.gst_cents
                            ? html`<span class="muted small"> + GST</span>` : ''}
                          ${s.gst_cents
                            ? html`<div class="muted small">${money(s.gross_cents, q.currency)} incl.</div>` : ''}
                        </td>
                      </tr>`),
                    html`<tr class="totals-row">
                      <td colspan="2" class="strong">Scheduled</td>
                      <td class="num strong ${stageTotal !== totals.totalCents ? 'warn' : ''}">
                        ${money(stageTotal, q.currency)}</td></tr>`,
                  ])}

              ${stages.length > 0 && stageTotal !== totals.totalCents
                ? html`<p class="alert alert-warn">The stages come to
                         ${money(stageTotal, q.currency)}, but the quote totals
                         ${money(totals.totalCents, q.currency)} — a difference of
                         ${money(Math.abs(stageTotal - totals.totalCents), q.currency)}. That may be
                         deliberate, but it is worth a look before this goes out.</p>`
                : ''}

              ${q.stage_note ? html`<p class="prewrap small mt"><strong>Note:</strong> ${q.stage_note}</p>` : ''}

              ${writable ? html`
                ${lines.length > 0 && stages.length === 0
                  ? html`<form method="post" action="/quotes/${q.id}/stages/generate" class="mb">
                           ${csrfField(csrf)}
                           <button class="btn btn-secondary" type="submit">Draft stages from the items</button>
                           <p class="hint">One stage per item, in order, which you can then reword,
                              split or merge.</p>
                         </form>`
                  : ''}

                ${stages.length > 0 ? html`
                  <details class="add-block">
                    <summary>Edit the stages</summary>
                    <form method="post" action="/quotes/${q.id}/stages">
                      ${csrfField(csrf)}
                      <input type="hidden" name="_action" value="save">
                      <div class="table-wrap">
                        <table class="edit-table">
                          <thead><tr><th>#</th><th>Stage</th><th>Description</th><th>Amount</th><th>GST</th><th></th></tr></thead>
                          <tbody>
                            ${stages.map((s, i) => html`
                              <tr>
                                <td><input name="position_${s.id}" value="${i + 1}" size="2" inputmode="numeric" aria-label="Order"></td>
                                <td><input name="label_${s.id}" value="${s.label}" size="8" maxlength="40" aria-label="Stage"></td>
                                <td><input name="description_${s.id}" value="${s.description}" maxlength="500" required aria-label="Description"></td>
                                <td><input name="amount_${s.id}" value="${(s.amount_cents / 100).toFixed(2)}" size="9" inputmode="decimal" required aria-label="Amount"></td>
                                <td><select name="gst_${s.id}" aria-label="GST">
                                  ${GST_TREATMENTS.map((g) => html`<option value="${g}" ${g === s.gst_treatment ? raw('selected') : ''}>${GST_TREATMENT_LABELS[g]}</option>`)}
                                </select></td>
                                <td><label class="small"><input type="checkbox" name="remove_${s.id}"> remove</label></td>
                              </tr>`)}
                          </tbody>
                        </table>
                      </div>
                      ${field({ label: 'Note under the schedule', name: 'stage_note', type: 'textarea',
                                rows: 2, maxlength: 1000, value: q.stage_note })}
                      <button class="btn btn-primary" type="submit">Save the stages</button>
                    </form>
                  </details>` : ''}

                <details class="add-block" ${stages.length === 0 ? raw('open') : ''}>
                  <summary>Add a stage</summary>
                  <form method="post" action="/quotes/${q.id}/stages" class="row-form">
                    ${csrfField(csrf)}
                    ${field({ label: 'Stage', name: 'label', maxlength: 40,
                              value: `Stage ${stages.length + 1}`, placeholder: 'Stage 1' })}
                    ${field({ label: 'Description', name: 'description', required: true, maxlength: 500,
                              placeholder: 'Case review and preparation — due on instruction' })}
                    ${field({ label: 'Amount', name: 'amount', required: true, placeholder: '0.00' })}
                    ${select({ label: 'GST', name: 'gst_treatment',
                               value: fees.gstRegistered ? fees.defaultTreatment : 'none',
                               includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
                    <button class="btn btn-primary" type="submit">Add stage</button>
                  </form>
                </details>` : ''}`)}

            ${writable && q.case_id && q.status === 'accepted' ? card('Record as case fees', html`
              <p>Copy this quote onto case <code>${q.case_ref}</code> as fee lines, so the money is tracked and split.</p>
              <form method="post" action="/quotes/${q.id}/to-fees">
                ${csrfField(csrf)}
                <button class="btn btn-primary" type="submit">Add to case fees</button>
              </form>`) : ''}

            ${writable ? card('Invoices', html`
              ${quoteInvoices.length === 0
                ? html`<p class="small muted">Nothing has been invoiced from this quote yet.</p>`
                : html`<ul class="list">${quoteInvoices.map((inv) => html`
                    <li class="list-row">
                      <div><a href="/invoices/${inv.id}"><code>${inv.ref}</code></a>
                        <span class="muted small">${money(inv.gross_cents, q.currency)}</span></div>
                      <div>${badge(inv.status, statusTone(inv.status === 'paid' ? 'approved' : inv.status))}</div>
                    </li>`)}</ul>`}
              <form method="post" action="/quotes/${q.id}/invoice" class="row-form mt">
                ${csrfField(csrf)}
                ${field({ label: 'Payment terms (days)', name: 'term_days', type: 'number', value: '7' })}
                <button class="btn btn-primary" type="submit">Raise an invoice</button>
              </form>
              <p class="hint">The lines are copied onto a new draft invoice; this quote is left
                 exactly as it is. A quote can reasonably be invoiced more than once — staged fees
                 are precisely that — so nothing here consumes it.</p>`) : ''}

            ${card('Timeline', entries.length === 0 ? emptyState('Nothing recorded yet.') : html`
              <ul class="timeline">${entries.map((e) => html`
                <li class="timeline-item">
                  <div class="timeline-meta"><span class="muted small">${stamp(e.occurred_at)}${e.author_name ? ` · ${e.author_name}` : ''}</span></div>
                  <div class="timeline-body">${e.body}</div>
                </li>`)}</ul>`)}
          </div>

          <div class="col-side">
            ${card('Status', html`
              <p>${badge(QUOTE_STATUS_LABELS[q.status], statusTone(q.status))}</p>
              ${writable ? html`
                <form method="post" action="/quotes/${q.id}/status" class="row-form">
                  ${csrfField(csrf)}
                  ${select({ label: 'Set status', name: 'status', value: q.status, includeBlank: false,
                             options: optionsFrom(QUOTE_STATUSES, QUOTE_STATUS_LABELS) })}
                  <button class="btn btn-secondary" type="submit">Update</button>
                </form>` : ''}`)}

            ${card('Linked to', html`
              <dl class="kv">
                <dt>Client</dt><dd>${q.client_id ? html`<a href="/clients/${q.client_id}">${q.client_name}</a>` : '—'}</dd>
                <dt>Case</dt><dd>${q.case_id ? html`<a href="/cases/${q.case_id}"><code>${q.case_ref}</code></a>` : '—'}</dd>
                <dt>Inquiry</dt><dd>${q.inquiry_id ? html`<a href="/inquiries/${q.inquiry_id}"><code>${q.inquiry_ref}</code></a>` : '—'}</dd>
                <dt>Issued</dt><dd>${dateShort(q.issued_on)}</dd>
                <dt>Valid until</dt><dd>${q.valid_until
                  ? html`${dateShort(q.valid_until)}
                         <div class="muted small">${q.validity_days ?? qSettings.validityDays} days including the day of issue</div>`
                  : '—'}</dd>
                <dt>Sent</dt><dd>${stamp(q.sent_at)}</dd>
                <dt>Answered</dt><dd>${stamp(q.responded_at)}</dd>
              </dl>
              ${writable ? html`
                <form method="post" action="/quotes/${q.id}/issue" class="mt">
                  ${csrfField(csrf)}
                  ${field({ label: 'Date of issue', name: 'issued_on', type: 'date',
                            value: dateInputValue(q.issued_on ?? nowIso()) })}
                  ${field({ label: 'Stands for (days)', name: 'validity_days',
                            value: String(q.validity_days ?? qSettings.validityDays), maxlength: 3 })}
                  <button class="btn btn-secondary btn-small" type="submit">Set validity</button>
                  <p class="hint">Counted inclusive of the day of issue. The quote prints the date,
                     not the number of days.</p>
                </form>` : ''}`)}

            ${card('Notes', html`<p class="prewrap">${q.notes || '—'}</p>`)}
          </div>
        </div>`);
    });

    /**
     * A printable quote. Rendered without the application chrome so that what
     * comes out of the printer is the document, not the screen around it.
     */
    r.get('/:id/print', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow & { client_name: string | null; case_ref: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name, k.ref AS case_ref FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id
           LEFT JOIN cases k ON k.id = q.case_id
          WHERE q.id = ?`,
        id,
      );
      if (!q) return c.notFound();
      const [practice, lines, qs, stages] = await Promise.all([
        practiceDetails(c.env), quoteLines(c.env, id), quoteSettings(c.env), quoteStages(c.env, id),
      ]);
      const totals = summariseQuote(lines.map((l) => ({
        kind: l.kind, lineAmountCents: l.unit_amount_cents,
        netCents: l.net_cents, gstCents: l.gst_cents, grossCents: l.gross_cents,
      })));
      const issuedOn = q.issued_on ?? q.created_at.slice(0, 10);
      const validTo = q.valid_until ?? validUntil(issuedOn, q.validity_days ?? qs.validityDays);
      const fees = lines.filter((l) => l.kind === 'professional');
      const disbursements = lines.filter((l) => l.kind !== 'professional');
      await auditFrom(c, { action: 'quote.printed', entityType: 'quote', entityId: id });

      const lineRows = (rows: QuoteItemRow[]) => rows.map((l) => html`
        <tr>
          <td>${l.description}</td>
          <td class="num">${formatQuantity(l.quantity_milli)} ${pluraliseUnit(l.unit_label, l.quantity_milli)}</td>
          <td class="num">${money(l.unit_amount_cents, q.currency)}</td>
          <td class="num">${money(l.net_cents, q.currency)}</td>
        </tr>`);

      return page(c, { title: `Quote ${q.ref}`, bare: true }, html`
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
              <h2>Fee quote</h2>
              <dl class="quote-doc-meta">
                <dt>Quote</dt><dd class="strong">${q.ref}</dd>
                <dt>Issued</dt><dd>${dateShort(issuedOn)}</dd>
                <dt>Valid until</dt><dd class="strong">${dateShort(validTo)}</dd>
                ${q.case_ref ? html`<dt>Matter</dt><dd>${q.case_ref}</dd>` : ''}
              </dl>
            </div>
          </header>

          <section>
            <h3>Prepared for</h3>
            <p class="strong">${q.client_name ?? '—'}</p>
          </section>

          ${q.description ? html`
            <section>
              <h3>Scope</h3>
              <p class="prewrap">${q.description}</p>
            </section>` : ''}

          ${lines.length === 0
            ? html`<p class="muted">No items have been added to this quote yet.</p>`
            : html`
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
                    <td class="num">${money(totals.feesNetCents, q.currency)}</td></tr>
                <tr><td colspan="3">Disbursements</td>
                    <td class="num">${money(totals.disbursementsNetCents, q.currency)}</td></tr>` : ''}
              <tr><td colspan="3">Subtotal</td>
                  <td class="num">${money(totals.subtotalNetCents, q.currency)}</td></tr>
              ${totals.hasGst
                ? html`<tr><td colspan="3">GST</td>
                           <td class="num">${money(totals.gstCents, q.currency)}</td></tr>`
                : html`<tr><td colspan="4" class="small muted">No GST applies to this quote.</td></tr>`}
              <tr class="totals-row">
                <td colspan="3" class="strong">Total payable</td>
                <td class="num strong">${money(totals.totalCents, q.currency)}</td></tr>
            </tfoot>
          </table>`}

          ${stages.length ? html`
          <section>
            <h3>Payment stages</h3>
            <table class="quote-doc-table">
              <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
              <tbody>
                ${stages.map((s) => html`
                  <tr>
                    <td>${s.label ? html`<strong>${s.label}</strong> ` : ''}${s.description}</td>
                    <td class="num">${money(s.net_cents, q.currency)}${
                      s.gst_treatment === 'exclusive' && s.gst_cents ? ' + GST' : ''}</td>
                  </tr>`)}
              </tbody>
              <tfoot>
                <tr class="totals-row">
                  <td class="strong">Total including GST</td>
                  <td class="num strong">${money(stages.reduce((n, s) => n + s.gross_cents, 0), q.currency)}</td>
                </tr>
              </tfoot>
            </table>
            ${q.stage_note ? html`<p class="small prewrap quote-doc-note"><strong>Note:</strong> ${q.stage_note}</p>` : ''}
          </section>` : ''}

          ${practice.showBankOnQuote && practice.bankAccountNumber ? html`
          <section>
            <h3>Payment</h3>
            <dl class="kv quote-doc-bank">
              ${practice.bankAccountHolder ? html`<dt>Account holder</dt><dd>${practice.bankAccountHolder}</dd>` : ''}
              ${practice.bankName ? html`<dt>Bank</dt><dd>${practice.bankName}</dd>` : ''}
              <dt>Account</dt><dd><strong>${practice.bankAccountNumber}</strong></dd>
            </dl>
            <p class="small muted">Please quote <strong>${q.ref}</strong> as the reference. If you
               receive an email appearing to change these details, telephone this office on the
               number above before paying anything.</p>
          </section>` : ''}

          <section class="quote-doc-terms">
            <h3>Conditions</h3>
            <ul class="quote-doc-conditions">
              <li>This quote is valid until <strong>${dateShort(validTo)}</strong>.</li>
              ${qs.capacityNote ? html`<li>${qs.capacityNote}</li>` : ''}
              ${qs.paymentTerms ? html`<li>${qs.paymentTerms}</li>` : ''}
              ${disbursements.length
                ? html`<li>Disbursements are amounts paid to third parties on your behalf and are
                           passed on to you without margin. Where an exact figure is not yet known,
                           the amount shown is an estimate and you will be told before it is
                           incurred.</li>`
                : ''}
              ${practice.termsUrl
                ? html`<li>This quote is given on the
                           <a href="${practice.termsUrl}" rel="noopener"><strong>${practice.termsLabel}</strong></a>,
                           which may be downloaded from that link. Please read those terms before
                           accepting.
                           <span class="print-only break-url">${practice.termsUrl}</span></li>`
                : ''}
            </ul>
          </section>

          <footer class="quote-doc-foot no-print">
            <button class="btn btn-primary" data-print type="button">Print this quote</button>
            <a class="btn btn-secondary" href="/quotes/${q.id}">Back to the quote</a>
          </footer>
        </article>`);
    });

    /** Compose an email of the quote. It is queued and recorded, never sent blind. */
    r.get('/:id/email', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow & { client_name: string | null; client_email: string | null }>(
        c.env.DB,
        `SELECT q.*, cl.full_name AS client_name, cl.email AS client_email FROM quotes q
           LEFT JOIN clients cl ON cl.id = q.client_id WHERE q.id = ?`,
        id,
      );
      if (!q) return c.notFound();

      const [practice, items, qs] = await Promise.all([
        practiceDetails(c.env), quoteLines(c.env, id), quoteSettings(c.env),
      ]);
      const csrf = c.get('session')!.csrf;
      const configured = mailConfigured(c.env);

      return page(c, { title: `Email ${q.ref}`, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { href: `/quotes/${q.id}`, label: q.ref }, { label: 'Email' }])}
        ${pageHeader(`Email quote ${q.ref}`, q.client_name ?? undefined)}

        ${configured
          ? ''
          : html`<div class="alert alert-warn">No outgoing mail provider is configured, so this will
                   be recorded and queued but not delivered. It sends as soon as one is set up —
                   see Settings → Integrations.</div>`}

        <form method="post" action="/quotes/${q.id}/email" class="form-grid compose">
          ${csrfField(csrf)}
          <div class="form-section">
            <h3>Message</h3>
            ${field({ label: 'To', name: 'to', type: 'email', required: true,
                      value: q.client_email ?? '', maxlength: 320 })}
            ${field({ label: 'Copy to', name: 'cc', type: 'email', value: '', maxlength: 320 })}
            ${field({ label: 'Subject', name: 'subject', required: true, maxlength: 200,
                      value: `Fee quote ${q.ref} — ${q.description}`.slice(0, 200) })}
          </div>

          ${/*
            * The body gets the full width of the form and a monospace face:
            * the figures are padded into columns, and in a proportional font
            * they do not line up with each other.
            */ ''}
          <div class="form-section form-section-wide js-compose">
            <div class="compose-bar">
              <div class="compose-tools">
                <button type="button" class="btn btn-small btn-secondary" data-wrap="**" title="Bold"><b>B</b></button>
                <button type="button" class="btn btn-small btn-secondary" data-wrap="*" title="Italic"><i>I</i></button>
                <button type="button" class="btn btn-small btn-secondary" data-prefix="## " title="Heading">H</button>
                <button type="button" class="btn btn-small btn-secondary" data-prefix="- " title="Bulleted list">&bull; List</button>
                <button type="button" class="btn btn-small btn-secondary" data-prefix="1. " title="Numbered list">1. List</button>
              </div>
              <fieldset class="compose-format">
                <legend class="visually-hidden">Send as</legend>
                <label><input type="radio" name="format" value="text" checked> Plain text</label>
                <label><input type="radio" name="format" value="html"> Formatted</label>
              </fieldset>
            </div>
            <div class="field">
              <label for="f_body">Message <span class="req"> *</span></label>
              <textarea id="f_body" name="body" rows="22" required maxlength="20000"
                        class="compose-body">${defaultQuoteEmail(q, practice, items, qs.capacityNote)}</textarea>
              <p class="hint">Written as plain text. Choosing <strong>Formatted</strong> sends a
                 tidy HTML version as well, with a plain-text copy for clients whose mail client
                 prefers it — <code>**bold**</code>, <code>*italic*</code>, <code>## heading</code>,
                 lines starting <code>-</code> or <code>1.</code> for lists, and web addresses become
                 links. Nothing else is interpreted, so what you type is what is sent.</p>
            </div>
            <div class="field checkbox-field">
              <label><input type="checkbox" name="mark_sent" checked>
                Mark this quote as sent</label>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Queue this email</button>
            <a class="btn btn-secondary" href="/quotes/${q.id}">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/:id/email', requirePermission('mail:send'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const to = f.email('to', { required: true, label: 'To' });
      const cc = f.email('cc');
      const subject = f.text('subject', { required: true, label: 'Subject', max: 200 });
      const body = f.text('body', { required: true, label: 'Message', max: 20000 });
      const asHtml = f.text('format', { max: 10 }) === 'html';
      const markSent = f.bool('mark_sent') === 1;
      if (!f.valid || !to) {
        return redirectWith(c, `/quotes/${id}/email`, Object.values(f.errors)[0] ?? 'Invalid message.', 'err');
      }

      // The plain text is sent either way. A formatted message is a multipart
      // one carrying both, so a client that cannot or will not render HTML
      // still gets a readable letter rather than a wall of markup.
      const outboundId = await queueEmail(c.env, {
        to, cc, subject, text: body,
        html: asHtml ? renderEmailHtml(body) : null,
        entityType: 'quote', entityId: id, createdBy: user.id,
      });

      if (markSent && q.status === 'draft') {
        await run(c.env.DB, `UPDATE quotes SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`,
          q.sent_at ?? nowIso(), nowIso(), id);
      }
      await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'email_out',
        body: `Quote emailed to ${to}${cc ? ` (copy to ${cc})` : ''}.\n\nSubject: ${subject}`,
        createdBy: user.id });
      if (q.client_id) {
        await addEntry(c.env, { entityType: 'client', entityId: q.client_id, kind: 'email_out',
          body: `Quote ${q.ref} emailed to ${to}.`, createdBy: user.id });
      }
      await auditFrom(c, { action: 'quote.emailed', entityType: 'quote', entityId: id,
        meta: { to, outboundId, format: asHtml ? 'html' : 'text' } });

      // Try to deliver straight away; the daily job picks up anything left.
      const result = await flushQueue(c.env, 5);
      return redirectWith(c, `/quotes/${id}`,
        result.sent > 0
          ? `Quote emailed to ${to}.`
          : `Quote queued for ${to}. It will send once an email provider is configured.`);
    });

    r.get('/:id/edit', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const [clients, settings, copied] = await Promise.all([
        clientOptions(c.env),
        feeSettings(c.env),
        one<{ n: number }>(c.env.DB,
          'SELECT COUNT(*) AS n FROM fee_items WHERE notes = ?', `From quote ${q.ref}`),
      ]);
      const csrf = c.get('session')!.csrf;

      // The stored figures are already net and GST, so present the treatment
      // that reproduces them rather than guessing what was originally typed.
      const treatment: GstTreatment = q.gst_cents > 0 ? 'exclusive' : 'none';

      return page(c, { title: `Edit ${q.ref}`, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { href: `/quotes/${q.id}`, label: q.ref }, { label: 'Edit' }])}
        ${pageHeader(`Edit ${q.ref}`)}
        ${(copied?.n ?? 0) > 0
          ? html`<div class="alert alert-warn">This quote has already been copied onto the case as fee
                   lines. Changing it here does not change those fee lines — edit them on the case.</div>`
          : ''}
        <form method="post" action="/quotes/${q.id}" class="form-grid">
          ${csrfField(csrf)}
          <div class="form-section">
            <h3>Who and what</h3>
            ${select({ label: 'Client', name: 'client_id', value: q.client_id ?? '', options: clients, includeBlank: 'No client yet' })}
            ${field({ label: 'Description', name: 'description', value: q.description, required: true, maxlength: 500 })}
          </div>
          <div class="form-section">
            <h3>Money</h3>
            ${field({ label: 'Professional fee', name: 'amount', value: (q.amount_cents / 100).toFixed(2), required: true,
                      hint: 'Enter it the way the GST treatment below describes.' })}
            ${select({ label: 'GST treatment', name: 'gst_treatment', value: treatment, includeBlank: false,
                       options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
            ${field({ label: 'Disbursements', name: 'disbursements', value: (q.disbursements_cents / 100).toFixed(2) })}
            ${field({ label: 'Valid until', name: 'valid_until', type: 'date', value: dateInputValue(q.valid_until) })}
            <p class="hint">GST is recalculated at the practice's current rate
               (${(settings.gstRateBp / 100).toFixed(2)}%).</p>
          </div>
          <div class="form-section">
            <h3>Notes</h3>
            ${field({ label: 'Internal notes', name: 'notes', type: 'textarea', rows: 4, value: q.notes, maxlength: 4000 })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save changes</button>
            <a class="btn btn-secondary" href="/quotes/${q.id}">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/:id', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const existing = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!existing) return c.notFound();

      const settings = await feeSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const clientId = f.optional('client_id', { max: 60 });
      const description = f.text('description', { required: true, label: 'Description', max: 500 });
      const amount = f.money('amount', { required: true, label: 'Professional fee' });
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: settings.defaultTreatment })! as GstTreatment;
      const disbursements = f.money('disbursements') ?? 0;
      const validUntil = f.date('valid_until');
      const notes = f.optional('notes', { max: 4000 });
      if (!f.valid || amount === null) {
        return redirectWith(c, `/quotes/${id}/edit`, Object.values(f.errors)[0] ?? 'Invalid quote.', 'err');
      }

      const rateBp = settings.gstRegistered ? settings.gstRateBp : 0;
      const { net, gst } = computeGst(amount, treatment, rateBp);

      await run(
        c.env.DB,
        `UPDATE quotes SET client_id = ?, description = ?, amount_cents = ?, gst_cents = ?,
           disbursements_cents = ?, valid_until = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        clientId || null, description, net, gst, disbursements, validUntil, notes, nowIso(), id,
      );

      const before = existing.amount_cents + existing.gst_cents + existing.disbursements_cents;
      const after = net + gst + disbursements;
      if (before !== after) {
        await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'system',
          body: `Quote total changed from ${money(before, existing.currency)} to ${money(after, existing.currency)}.`,
          createdBy: user.id });
      }
      await auditFrom(c, { action: 'quote.updated', entityType: 'quote', entityId: id,
        meta: { before, after } });
      return redirectWith(c, `/quotes/${id}`, 'Quote updated.');
    });

    r.post('/:id/status', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const status = f.enum('status', QUOTE_STATUSES, { required: true });
      if (!status) return redirectWith(c, `/quotes/${id}`, 'Unknown status.', 'err');

      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      await run(
        c.env.DB,
        `UPDATE quotes SET status = ?, sent_at = ?, responded_at = ?, updated_at = ? WHERE id = ?`,
        status,
        status === 'sent' ? (q.sent_at ?? nowIso()) : q.sent_at,
        status === 'accepted' || status === 'declined' ? (q.responded_at ?? nowIso()) : q.responded_at,
        nowIso(), id,
      );
      await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'system',
        body: `Quote ${QUOTE_STATUS_LABELS[status].toLowerCase()}.`, createdBy: user.id });
      if (q.client_id) {
        await addEntry(c.env, { entityType: 'client', entityId: q.client_id, kind: 'system',
          body: `Quote ${q.ref} ${QUOTE_STATUS_LABELS[status].toLowerCase()}.`, createdBy: user.id });
      }
      await auditFrom(c, { action: 'quote.status_changed', entityType: 'quote', entityId: id, meta: { status } });
      return redirectWith(c, `/quotes/${id}`, `Quote marked ${QUOTE_STATUS_LABELS[status].toLowerCase()}.`);
    });

    /** Turn an accepted quote into fee lines on its case. */

    // --- Quote lines --------------------------------------------------------

    r.post('/:id/items', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const fees = await feeSettings(c.env);
      const qs = await quoteSettings(c.env);
      const form = await c.req.formData();
      const f = new FormReader(form);

      // The same route both adds a line and saves edits to the existing ones,
      // because both end in exactly the same place: recalculate the lines, then
      // bring the quote's header totals back into step with them.
      if (form.get('_action') === 'save') {
        const existing = await quoteLines(c.env, id);
        const problems: string[] = [];
        let removed = 0;

        for (const line of existing) {
          if (form.get(`remove_${line.id}`)) {
            await run(c.env.DB, 'DELETE FROM quote_items WHERE id = ? AND quote_id = ?', line.id, id);
            removed += 1;
            continue;
          }

          const description = String(form.get(`description_${line.id}`) ?? '').trim().slice(0, 300);
          const quantity = parseQuantityToMilli(String(form.get(`quantity_${line.id}`) ?? ''));
          const unitAmount = parseMoneyToCents(String(form.get(`amount_${line.id}`) ?? ''));
          const kind = FEE_KINDS.includes(String(form.get(`kind_${line.id}`)) as never)
            ? String(form.get(`kind_${line.id}`)) : line.kind;
          const treatment = GST_TREATMENTS.includes(String(form.get(`gst_${line.id}`)) as never)
            ? String(form.get(`gst_${line.id}`)) : line.gst_treatment;
          const positionRaw = Number(String(form.get(`position_${line.id}`) ?? ''));
          const position = Number.isFinite(positionRaw) ? Math.max(0, Math.trunc(positionRaw)) : line.position;

          // A line that cannot be read is left exactly as it was rather than
          // being written half-changed or silently dropped.
          if (!description || quantity === null || unitAmount === null) {
            problems.push(line.description);
            continue;
          }

          const gstRateBp = fees.gstRegistered && treatment !== 'none' ? fees.gstRateBp : 0;
          const amounts = computeLine({
            quantityMilli: quantity, unitAmountCents: unitAmount,
            gstTreatment: (fees.gstRegistered ? treatment : 'none') as GstTreatment, gstRateBp,
          });
          await run(
            c.env.DB,
            `UPDATE quote_items SET position = ?, description = ?, kind = ?, unit_label = ?,
                quantity_milli = ?, unit_amount_cents = ?, gst_treatment = ?, gst_rate_bp = ?,
                net_cents = ?, gst_cents = ?, gross_cents = ?, updated_at = ?
              WHERE id = ? AND quote_id = ?`,
            position, description, kind,
            String(form.get(`unit_${line.id}`) ?? line.unit_label).trim().slice(0, 30) || qs.defaultUnitLabel,
            quantity, unitAmount, fees.gstRegistered ? treatment : 'none', gstRateBp,
            amounts.netCents, amounts.gstCents, amounts.grossCents, nowIso(), line.id, id,
          );
        }

        const totals = await refreshQuoteTotals(c.env, id);
        await auditFrom(c, { action: 'quote.lines_saved', entityType: 'quote', entityId: id,
          meta: { removed, rejected: problems.length, total: totals.totalCents } });

        return problems.length
          ? redirectWith(c, `/quotes/${id}`,
              `Saved, except ${problems.length} line(s) with a quantity or price that could not be read: ${problems.join('; ')}.`, 'err')
          : redirectWith(c, `/quotes/${id}`, removed ? `Saved. ${removed} line(s) removed.` : 'Lines saved.');
      }

      const description = f.text('description', { required: true, label: 'Description', max: 300 });
      const unitAmount = f.money('unit_amount', { required: true, label: 'Price per unit' });
      const quantity = parseQuantityToMilli(f.text('quantity', { max: 10 }) || '1');
      const kind = f.enum('kind', FEE_KINDS, { fallback: 'professional' })!;
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: 'exclusive' })!;
      const serviceItemId = f.optional('service_item_id', { max: 40 });
      if (!f.valid) return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0]!, 'err');
      if (quantity === null) {
        return redirectWith(c, `/quotes/${id}`, 'Give the quantity as a number, e.g. 1, 2 or 0.25.', 'err');
      }

      // The rate is stamped on the line, not looked up later, so reopening an
      // old quote shows the arithmetic that was actually sent.
      const gstRateBp = fees.gstRegistered && treatment !== 'none' ? fees.gstRateBp : 0;
      const amounts = computeLine({
        quantityMilli: quantity, unitAmountCents: unitAmount!,
        gstTreatment: fees.gstRegistered ? treatment : 'none', gstRateBp,
      });

      const nextPosition = await count(c.env.DB,
        'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM quote_items WHERE quote_id = ?', id);
      const now = nowIso();
      await run(
        c.env.DB,
        `INSERT INTO quote_items (id, quote_id, position, service_item_id, description, kind, unit_label,
            quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
            net_cents, gst_cents, gross_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('qit'), id, nextPosition, serviceItemId || null, description, kind,
        f.optional('unit_label', { max: 30 }) || qs.defaultUnitLabel,
        quantity, unitAmount, fees.gstRegistered ? treatment : 'none', gstRateBp,
        amounts.netCents, amounts.gstCents, amounts.grossCents, now, now,
      );

      const totals = await refreshQuoteTotals(c.env, id);
      await auditFrom(c, { action: 'quote.line_added', entityType: 'quote', entityId: id,
        meta: { description, total: totals.totalCents } });
      return redirectWith(c, `/quotes/${id}`, `Added “${description}”.`);
    });

    r.post('/:id/items/:itemId/remove', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      await run(c.env.DB, 'DELETE FROM quote_items WHERE id = ? AND quote_id = ?', c.req.param('itemId')!, id);
      await refreshQuoteTotals(c.env, id);
      await auditFrom(c, { action: 'quote.line_removed', entityType: 'quote', entityId: id });
      return redirectWith(c, `/quotes/${id}`, 'Line removed.');
    });

    /**
     * Set the date of issue and how long the quote stands.
     *
     * Both are stored on the quote rather than read from settings at print
     * time: a quote already given to a client promised a particular date, and
     * changing the practice's default afterwards must not silently rewrite it.
     */
    r.post('/:id/issue', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const qs = await quoteSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const issuedOn = f.date('issued_on') ?? nowIso().slice(0, 10);
      const days = f.int('validity_days', { min: 1, max: 365 }) ?? qs.validityDays;
      if (!f.valid) return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0]!, 'err');

      const until = validUntil(issuedOn, days);
      await run(
        c.env.DB,
        'UPDATE quotes SET issued_on = ?, validity_days = ?, valid_until = ?, updated_at = ? WHERE id = ?',
        issuedOn, days, until, nowIso(), id,
      );
      await auditFrom(c, { action: 'quote.validity_set', entityType: 'quote', entityId: id,
        meta: { issuedOn, days, until } });
      return redirectWith(c, `/quotes/${id}`, `Valid until ${until}.`);
    });


    // --- Payment stages -----------------------------------------------------

    /** Add one stage, or save edits to all of them. */
    r.post('/:id/stages', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT id FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();

      const fees = await feeSettings(c.env);
      const form = await c.req.formData();
      const now = nowIso();

      const figures = (amountCents: number, treatment: GstTreatment) => {
        const rateBp = fees.gstRegistered && treatment !== 'none' ? fees.gstRateBp : 0;
        const gst = computeGst(amountCents, fees.gstRegistered ? treatment : 'none', rateBp);
        return { rateBp, net: gst.net, gstCents: gst.gst, gross: gst.gross };
      };

      if (form.get('_action') === 'save') {
        const existing = await quoteStages(c.env, id);
        const problems: string[] = [];
        let removed = 0;

        for (const stage of existing) {
          if (form.get(`remove_${stage.id}`)) {
            await run(c.env.DB, 'DELETE FROM quote_stages WHERE id = ? AND quote_id = ?', stage.id, id);
            removed += 1;
            continue;
          }
          const description = String(form.get(`description_${stage.id}`) ?? '').trim().slice(0, 500);
          const amount = parseMoneyToCents(String(form.get(`amount_${stage.id}`) ?? ''));
          if (!description || amount === null) { problems.push(stage.label || stage.description); continue; }

          const treatment = (GST_TREATMENTS.includes(String(form.get(`gst_${stage.id}`)) as never)
            ? String(form.get(`gst_${stage.id}`)) : stage.gst_treatment) as GstTreatment;
          const positionRaw = Number(String(form.get(`position_${stage.id}`) ?? ''));
          const f2 = figures(amount, treatment);
          await run(
            c.env.DB,
            `UPDATE quote_stages SET position = ?, label = ?, description = ?, amount_cents = ?,
                gst_treatment = ?, gst_rate_bp = ?, net_cents = ?, gst_cents = ?, gross_cents = ?,
                updated_at = ? WHERE id = ? AND quote_id = ?`,
            Number.isFinite(positionRaw) ? Math.max(0, Math.trunc(positionRaw)) : stage.position,
            String(form.get(`label_${stage.id}`) ?? '').trim().slice(0, 40),
            description, amount, fees.gstRegistered ? treatment : 'none', f2.rateBp,
            f2.net, f2.gstCents, f2.gross, now, stage.id, id,
          );
        }

        await run(c.env.DB, 'UPDATE quotes SET stage_note = ?, updated_at = ? WHERE id = ?',
          String(form.get('stage_note') ?? '').trim().slice(0, 1000) || null, now, id);
        await auditFrom(c, { action: 'quote.stages_saved', entityType: 'quote', entityId: id,
          meta: { removed, rejected: problems.length } });

        return problems.length
          ? redirectWith(c, `/quotes/${id}`,
              `Saved, except ${problems.length} stage(s) with an amount that could not be read.`, 'err')
          : redirectWith(c, `/quotes/${id}`, removed ? `Saved. ${removed} stage(s) removed.` : 'Stages saved.');
      }

      const f = new FormReader(form);
      const description = f.text('description', { required: true, label: 'Description', max: 500 });
      const amount = f.money('amount', { required: true, label: 'Amount' });
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: 'exclusive' })!;
      if (!f.valid || amount === null) {
        return redirectWith(c, `/quotes/${id}`, Object.values(f.errors)[0] ?? 'Give the stage an amount.', 'err');
      }

      const position = await count(c.env.DB,
        'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM quote_stages WHERE quote_id = ?', id);
      const fig = figures(amount, treatment);
      await run(
        c.env.DB,
        `INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
            gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        newId('qst'), id, position, f.optional('label', { max: 40 }) ?? '', description, amount,
        fees.gstRegistered ? treatment : 'none', fig.rateBp, fig.net, fig.gstCents, fig.gross, now, now,
      );
      await auditFrom(c, { action: 'quote.stage_added', entityType: 'quote', entityId: id,
        meta: { description } });
      return redirectWith(c, `/quotes/${id}`, 'Stage added.');
    });

    /**
     * A first draft of the schedule, one stage per item.
     *
     * A starting point, not an answer: most practices split the professional
     * work into a deposit and a balance, which is a judgement about this client
     * and this matter. Getting the wording and the figures onto the page is the
     * tedious part, and this does that.
     */
    r.post('/:id/stages/generate', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const existing = await quoteStages(c.env, id);
      if (existing.length > 0) {
        return redirectWith(c, `/quotes/${id}`, 'This quote already has stages — edit those instead.', 'err');
      }
      const lines = await quoteLines(c.env, id);
      if (lines.length === 0) return redirectWith(c, `/quotes/${id}`, 'Add some items first.', 'err');

      const now = nowIso();
      let n = 0;
      for (const line of lines) {
        n += 1;
        const due = line.kind === 'professional'
          ? 'due when this part is performed'
          : 'due when the application is ready for lodgement';
        await run(
          c.env.DB,
          `INSERT INTO quote_stages (id, quote_id, position, label, description, amount_cents,
              gst_treatment, gst_rate_bp, net_cents, gst_cents, gross_cents, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          newId('qst'), id, n - 1, `Stage ${n}`,
          `${line.description} — ${due}.`,
          line.unit_amount_cents * (line.quantity_milli / 1000),
          line.gst_treatment, line.gst_rate_bp,
          line.net_cents, line.gst_cents, line.gross_cents, now, now,
        );
      }
      await auditFrom(c, { action: 'quote.stages_generated', entityType: 'quote', entityId: id, meta: { stages: n } });
      return redirectWith(c, `/quotes/${id}`, `Drafted ${n} stage(s). Reword them to suit the matter.`);
    });

    r.post('/:id/invoice', requirePermission('quote:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const raw0 = Number(f.optional('term_days', { max: 4 }) ?? '7');
      const termDays = Number.isFinite(raw0) ? Math.max(0, Math.min(365, Math.round(raw0))) : 7;

      const result = await invoiceFromQuote(c.env, id, c.get('user')!.id, { termDays });
      if (!result.ok) return redirectWith(c, `/quotes/${id}`, result.message, 'err');

      await auditFrom(c, { action: 'quote.invoiced', entityType: 'quote', entityId: id,
        meta: { invoice: result.ref } });
      return redirectWith(c, `/invoices/${result.id}`,
        `${result.ref} raised as a draft. Check it, then issue it.`, 'ok');
    });

    r.post('/:id/to-fees', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const q = await one<QuoteRow>(c.env.DB, 'SELECT * FROM quotes WHERE id = ?', id);
      if (!q) return c.notFound();
      if (!q.case_id) return redirectWith(c, `/quotes/${id}`, 'Link this quote to a case first.', 'err');

      const existing = await one<{ n: number }>(
        c.env.DB, `SELECT COUNT(*) AS n FROM fee_items WHERE case_id = ? AND notes = ?`, q.case_id, `From quote ${q.ref}`,
      );
      if ((existing?.n ?? 0) > 0) return redirectWith(c, `/quotes/${id}`, 'This quote has already been copied to case fees.', 'err');

      const lines = await quoteLines(c.env, id);
      if (lines.length === 0) return redirectWith(c, `/quotes/${id}`, 'This quote has no items to record.', 'err');

      // One fee line per quote line, not one lump. The quote's itemisation is
      // what the client agreed to, so it is what the case should show — and it
      // is the only way the split can be right, because only professional fees
      // are apportioned. Disbursements are money passed through on the client's
      // behalf; apportioning them would hand the practice a share of somebody
      // else's fee.
      const stmts: D1PreparedStatement[] = lines.map((l) => {
        const quantity = l.quantity_milli === 1000
          ? ''
          : ` (${formatQuantity(l.quantity_milli)} ${pluraliseUnit(l.unit_label, l.quantity_milli)} × ${money(l.unit_amount_cents, q.currency)})`;
        return c.env.DB.prepare(
          `INSERT INTO fee_items (id, case_id, description, kind, amount_cents, gst_treatment, gst_rate_bp,
             net_cents, gst_cents, gross_cents, currency, include_in_split, status, notes, created_at, updated_at, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'quoted',?,?,?,?)`,
        ).bind(
          newId('fee'), q.case_id, `${l.description}${quantity}`, l.kind,
          l.unit_amount_cents === l.net_cents ? l.net_cents : l.net_cents,
          l.gst_treatment, l.gst_rate_bp,
          l.net_cents, l.gst_cents, l.gross_cents, q.currency,
          l.kind === 'professional' ? 1 : 0,
          `From quote ${q.ref}`, nowIso(), nowIso(), user.id,
        );
      });
      await c.env.DB.batch(stmts);

      const totals = summariseQuote(lines.map((l) => ({
        kind: l.kind, lineAmountCents: l.unit_amount_cents,
        netCents: l.net_cents, gstCents: l.gst_cents, grossCents: l.gross_cents,
      })));
      await addEntry(c.env, { entityType: 'case', entityId: q.case_id, kind: 'system',
        body: `Fees recorded from quote ${q.ref} — ${lines.length} line(s), ${money(totals.totalCents, q.currency)} total.`,
        createdBy: user.id });
      await auditFrom(c, { action: 'quote.copied_to_fees', entityType: 'quote', entityId: id, meta: { caseId: q.case_id } });
      return redirectWith(c, `/cases/${q.case_id}`, `Fees recorded from quote ${q.ref}.`);
    });

    app.route('/quotes', r);
  },
};

/** The catalogue form, read the same way whether adding or editing. */
function readCatalogueForm(f: FormReader) {
  const name = f.text('name', { required: true, label: 'Name', max: 120 });
  return {
    name,
    description: f.optional('description', { max: 300 }),
    kind: f.enum('kind', FEE_KINDS, { fallback: 'professional' })!,
    unitLabel: f.optional('unit_label', { max: 30 }) || 'item',
    unitAmount: f.money('unit_amount') ?? 0,
    treatment: f.enum('gst_treatment', GST_TREATMENTS, { fallback: 'exclusive' })!,
  };
}

/**
 * A typed amount as whole cents, or null if it is not a number.
 *
 * `FormReader.money` records an error against the form; here each line is read
 * independently, and one unreadable line must not stop the others being saved.
 */
function parseMoneyToCents(input: string): number | null {
  const clean = input.trim().replace(/[$,\s]/g, '').replace(',', '.');
  if (!/^-?\d{0,9}(\.\d{1,2})?$/.test(clean) || clean === '' || clean === '.') return null;
  const value = Math.round(Number(clean) * 100);
  return Number.isFinite(value) ? value : null;
}
