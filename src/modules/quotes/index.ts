/**
 * Module: quotes.
 *
 * What was quoted, to whom, when, and what came of it. A quote is a proposal;
 * once accepted it can be pushed into the case's fee lines in one action so the
 * money is recorded exactly once.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { all, nextRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import {
  badge, card, csrfField, emptyState, field, optionsFrom, pageHeader, select, statusTone, table,
} from '../../ui/components';
import { dateShort, money } from '../../ui/format';
import { QUOTE_STATUS_LABELS, QUOTE_STATUSES, type QuoteStatus } from '../../domain';
import { clientOptions } from '../../core/lookups';
import { addEntry, listEntries } from '../../core/timeline';
import { can } from '../../core/rbac';
import { computeGst, GST_TREATMENT_LABELS, GST_TREATMENTS, type GstTreatment } from '../../core/fees';
import { feeSettings } from '../fees';

export interface QuoteRow {
  id: string; ref: string; client_id: string | null; case_id: string | null; inquiry_id: string | null;
  description: string; amount_cents: number; gst_cents: number; disbursements_cents: number;
  currency: string; status: QuoteStatus; valid_until: string | null; sent_at: string | null;
  responded_at: string | null; notes: string | null; created_at: string; updated_at: string;
}

function quoteTotal(q: Pick<QuoteRow, 'amount_cents' | 'gst_cents' | 'disbursements_cents'>): number {
  return q.amount_cents + q.gst_cents + q.disbursements_cents;
}

export const quotesModule: AppModule = {
  name: 'quotes',
  title: 'Quotes',
  basePaths: ['/quotes'],
  nav: [{ href: '/quotes', label: 'Quotes', permission: 'register:read', order: 60 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const status = c.req.query('status') ?? '';
      const conds: string[] = [];
      const params: unknown[] = [];
      if ((QUOTE_STATUSES as readonly string[]).includes(status)) { conds.push('q.status = ?'); params.push(status); }
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

      return page(c, { title: 'Quotes', active: '/quotes' }, html`
        ${pageHeader('Quotes', 'Fees proposed, and how they landed.',
          can(c.get('user'), 'quote:write') ? html`<a class="btn btn-primary" href="/quotes/new">New quote</a>` : undefined)}
        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Awaiting reply</span><span class="stat-value">${outstanding.length}</span></div>
          <div class="stat"><span class="stat-label">Value out</span><span class="stat-value">${money(outstanding.reduce((s, q) => s + quoteTotal(q), 0))}</span></div>
          <div class="stat"><span class="stat-label">Accepted</span><span class="stat-value">${money(accepted.reduce((s, q) => s + quoteTotal(q), 0))}</span></div>
        </div>
        <form method="get" action="/quotes" class="filters">
          <select name="status"><option value="">All statuses</option>
            ${QUOTE_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${QUOTE_STATUS_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        ${table(['Reference', 'Client', 'Description', 'Total', 'Valid until', 'Status'], rows.map((row) => html`
          <tr>
            <td><a href="/quotes/${row.id}"><code>${row.ref}</code></a></td>
            <td class="small">${row.client_id ? html`<a href="/clients/${row.client_id}">${row.client_name}</a>` : '—'}</td>
            <td>${row.description}${row.case_ref ? html`<div class="muted small">${row.case_ref}</div>` : ''}</td>
            <td class="num strong">${money(quoteTotal(row), row.currency)}</td>
            <td class="small">${dateShort(row.valid_until)}</td>
            <td>${badge(QUOTE_STATUS_LABELS[row.status], statusTone(row.status))}</td>
          </tr>`))}`);
    });

    r.get('/new', requirePermission('quote:write'), async (c) => {
      const csrf = c.get('session')!.csrf;
      const clients = await clientOptions(c.env);
      const settings = await feeSettings(c.env);
      const presetClient = c.req.query('client_id') ?? '';
      const presetCase = c.req.query('case_id') ?? '';
      const presetInquiry = c.req.query('inquiry_id') ?? '';

      return page(c, { title: 'New quote', active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: 'New' }])}
        ${pageHeader('New quote')}
        <form method="post" action="/quotes" class="form-grid">
          ${csrfField(csrf)}
          <input type="hidden" name="case_id" value="${presetCase}">
          <input type="hidden" name="inquiry_id" value="${presetInquiry}">
          <div class="form-section">
            <h3>Who and what</h3>
            ${select({ label: 'Client', name: 'client_id', value: presetClient, options: clients, includeBlank: 'No client yet' })}
            ${field({ label: 'Description', name: 'description', required: true, maxlength: 500,
                      placeholder: 'e.g. Partnership work visa — preparation and lodgement' })}
          </div>
          <div class="form-section">
            <h3>Money</h3>
            ${field({ label: 'Professional fee', name: 'amount', required: true, placeholder: '2500.00' })}
            ${select({ label: 'GST treatment', name: 'gst_treatment',
                       value: settings.gstRegistered ? settings.defaultTreatment : 'none', includeBlank: false,
                       options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
            ${field({ label: 'Disbursements (INZ fees, medicals)', name: 'disbursements', placeholder: '0.00',
                      hint: 'Passed through at cost; no GST is added by this register.' })}
            ${field({ label: 'Valid until', name: 'valid_until', type: 'date' })}
          </div>
          <div class="form-section">
            <h3>Notes</h3>
            ${field({ label: 'Internal notes', name: 'notes', type: 'textarea', rows: 4, maxlength: 4000 })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Create quote</button>
            <a class="btn btn-secondary" href="/quotes">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/', requirePermission('quote:write'), async (c) => {
      const user = c.get('user')!;
      const settings = await feeSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const clientId = f.optional('client_id', { max: 60 });
      const caseId = f.optional('case_id', { max: 60 });
      const inquiryId = f.optional('inquiry_id', { max: 60 });
      const description = f.text('description', { required: true, label: 'Description', max: 500 });
      const amount = f.money('amount', { required: true, label: 'Professional fee' });
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: settings.defaultTreatment })! as GstTreatment;
      const disbursements = f.money('disbursements') ?? 0;
      const validUntil = f.date('valid_until');
      const notes = f.optional('notes', { max: 4000 });
      if (!f.valid || amount === null) return redirectWith(c, '/quotes/new', Object.values(f.errors)[0] ?? 'Invalid quote.', 'err');

      const rateBp = settings.gstRegistered ? settings.gstRateBp : 0;
      const { net, gst } = computeGst(amount, treatment, rateBp);

      const id = newId('quo');
      const ref = await nextRef(c.env.DB, 'quote', 'Q');
      await run(
        c.env.DB,
        `INSERT INTO quotes (id, ref, client_id, case_id, inquiry_id, description, amount_cents, gst_cents,
            disbursements_cents, currency, status, valid_until, notes, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?, 'NZD', 'draft', ?,?,?,?,?)`,
        id, ref, clientId || null, caseId || null, inquiryId || null, description,
        net, gst, disbursements, validUntil, notes, nowIso(), nowIso(), user.id,
      );
      await addEntry(c.env, { entityType: 'quote', entityId: id, kind: 'system',
        body: `Quote ${ref} drafted — ${money(net + gst + disbursements)} total.`, createdBy: user.id });
      if (clientId) {
        await addEntry(c.env, { entityType: 'client', entityId: clientId, kind: 'system',
          body: `Quote ${ref} drafted: ${description}.`, createdBy: user.id });
      }
      if (inquiryId) {
        await run(c.env.DB, `UPDATE inquiries SET status = 'quoted', updated_at = ? WHERE id = ? AND status IN ('new','triaged','responded')`, nowIso(), inquiryId);
      }
      await auditFrom(c, { action: 'quote.created', entityType: 'quote', entityId: id, meta: { ref } });
      return redirectWith(c, `/quotes/${id}`, `Quote ${ref} created.`);
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

      const entries = await listEntries(c.env, 'quote', id);
      const csrf = c.get('session')!.csrf;
      const writable = can(c.get('user'), 'quote:write');

      return page(c, { title: q.ref, active: '/quotes' }, html`
        ${breadcrumbs([{ href: '/quotes', label: 'Quotes' }, { label: q.ref }])}
        ${pageHeader(q.description, `${q.ref} · ${QUOTE_STATUS_LABELS[q.status]}`)}

        <div class="cols">
          <div class="col-main">
            ${card('Amounts', table(['Item', 'Amount'], [
              html`<tr><td>Professional fee (net)</td><td class="num">${money(q.amount_cents, q.currency)}</td></tr>`,
              html`<tr><td>GST</td><td class="num">${money(q.gst_cents, q.currency)}</td></tr>`,
              html`<tr><td>Disbursements</td><td class="num">${money(q.disbursements_cents, q.currency)}</td></tr>`,
              html`<tr class="totals-row"><td class="strong">Total payable</td><td class="num strong">${money(quoteTotal(q), q.currency)}</td></tr>`,
            ]))}

            ${writable && q.case_id && q.status === 'accepted' ? card('Record as case fees', html`
              <p>Copy this quote onto case <code>${q.case_ref}</code> as fee lines, so the money is tracked and split.</p>
              <form method="post" action="/quotes/${q.id}/to-fees">
                ${csrfField(csrf)}
                <button class="btn btn-primary" type="submit">Add to case fees</button>
              </form>`) : ''}

            ${card('Timeline', entries.length === 0 ? emptyState('Nothing recorded yet.') : html`
              <ul class="timeline">${entries.map((e) => html`
                <li class="timeline-item">
                  <div class="timeline-meta"><span class="muted small">${dateShort(e.occurred_at)}${e.author_name ? ` · ${e.author_name}` : ''}</span></div>
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
                <dt>Valid until</dt><dd>${dateShort(q.valid_until)}</dd>
                <dt>Sent</dt><dd>${dateShort(q.sent_at)}</dd>
                <dt>Answered</dt><dd>${dateShort(q.responded_at)}</dd>
              </dl>`)}

            ${card('Notes', html`<p class="prewrap">${q.notes || '—'}</p>`)}
          </div>
        </div>`);
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

      const settings = await feeSettings(c.env);
      const rateBp = settings.gstRegistered ? settings.gstRateBp : 0;
      const stmts: D1PreparedStatement[] = [];
      const insert = (description: string, kind: string, net: number, gst: number, includeInSplit: number) =>
        c.env.DB.prepare(
          `INSERT INTO fee_items (id, case_id, description, kind, amount_cents, gst_treatment, gst_rate_bp,
             net_cents, gst_cents, gross_cents, currency, include_in_split, status, notes, created_at, updated_at, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'quoted',?,?,?,?)`,
        ).bind(
          newId('fee'), q.case_id, description, kind, net, gst > 0 ? 'exclusive' : 'none', gst > 0 ? rateBp : 0,
          net, gst, net + gst, q.currency, includeInSplit, `From quote ${q.ref}`, nowIso(), nowIso(), user.id,
        );

      stmts.push(insert(q.description, 'professional', q.amount_cents, q.gst_cents, 1));
      if (q.disbursements_cents > 0) {
        stmts.push(insert(`Disbursements (quote ${q.ref})`, 'disbursement', q.disbursements_cents, 0, 0));
      }
      await c.env.DB.batch(stmts);

      await addEntry(c.env, { entityType: 'case', entityId: q.case_id, kind: 'system',
        body: `Fees recorded from quote ${q.ref} — ${money(quoteTotal(q), q.currency)} total.`, createdBy: user.id });
      await auditFrom(c, { action: 'quote.copied_to_fees', entityType: 'quote', entityId: id, meta: { caseId: q.case_id } });
      return redirectWith(c, `/cases/${q.case_id}`, `Fees recorded from quote ${q.ref}.`);
    });

    app.route('/quotes', r);
  },
};
