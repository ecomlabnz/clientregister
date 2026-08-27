/**
 * Module: fees.
 *
 * Records what a case earns, how GST is treated on each line, and how the net
 * is split between the principal and the admin team (or any other parties).
 * Every case gets a split, seeded from the practice default and adjustable per
 * case. The arithmetic itself lives in core/fees.ts and is unit tested.
 */

import { Hono } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import { all, getSetting, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import { badge, card, csrfField, field, optionsFrom, pageHeader, select, statusTone, table } from '../../ui/components';
import { dateShort, money } from '../../ui/format';
import { addEntry } from '../../core/timeline';
import {
  allocateSplit, computeGst, FEE_KIND_LABELS, FEE_KINDS, FEE_STATUS_LABELS, FEE_STATUSES,
  formatBp, GST_TREATMENT_LABELS, GST_TREATMENTS, parsePercentToBp, SPLIT_BASE_LABELS, SPLIT_BASES,
  sumBp, summariseFees, type FeeKind, type FeeStatus, type GstTreatment, type SplitBase,
} from '../../core/fees';

export interface FeeItemRow {
  id: string; case_id: string; description: string; kind: FeeKind;
  amount_cents: number; gst_treatment: GstTreatment; gst_rate_bp: number;
  net_cents: number; gst_cents: number; gross_cents: number; currency: string;
  include_in_split: number; status: FeeStatus; invoiced_at: string | null; paid_at: string | null;
  notes: string | null; created_at: string;
}

export interface FeeShareRow {
  id: string; case_id: string; party_key: string; label: string;
  percent_bp: number; user_id: string | null; position: number;
}

interface DefaultShare { party_key: string; label: string; percent_bp: number }

export async function feeSettings(env: Env): Promise<{
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

/** Give a case its split, copying the practice default if it has none yet. */
export async function ensureShares(env: Env, caseId: string): Promise<FeeShareRow[]> {
  const existing = await all<FeeShareRow>(
    env.DB, 'SELECT * FROM fee_shares WHERE case_id = ? ORDER BY position, rowid', caseId,
  );
  if (existing.length > 0) return existing;

  const { defaultShares } = await feeSettings(env);
  const stmts = defaultShares.map((s, i) =>
    env.DB.prepare(
      `INSERT INTO fee_shares (id, case_id, party_key, label, percent_bp, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId('shr'), caseId, s.party_key, s.label, s.percent_bp, i, nowIso(), nowIso()),
  );
  if (stmts.length > 0) await env.DB.batch(stmts);
  return all<FeeShareRow>(env.DB, 'SELECT * FROM fee_shares WHERE case_id = ? ORDER BY position, rowid', caseId);
}

export async function loadFees(env: Env, caseId: string) {
  const [items, shares, settings] = await Promise.all([
    all<FeeItemRow>(env.DB, 'SELECT * FROM fee_items WHERE case_id = ? ORDER BY created_at', caseId),
    ensureShares(env, caseId),
    feeSettings(env),
  ]);
  const totals = summariseFees(items, settings.splitBase);
  const allocation = allocateSplit(totals.splitBaseCents, shares);
  return { items, shares, settings, totals, allocation };
}

/** The fees panel embedded in the case page. */
export async function feesSection(c: any, caseId: string, currency: string, canWrite: boolean): Promise<Raw> {
  const { items, shares, settings, totals, allocation } = await loadFees(c.env, caseId);
  const csrf = c.get('session').csrf;
  const bpTotal = sumBp(shares);
  const unallocated = totals.splitBaseCents - allocation.reduce((s, a) => s + a.amount_cents, 0);

  const itemRows = items.map((it) => html`
    <tr class="${it.status === 'cancelled' || it.status === 'written_off' ? 'row-muted' : ''}">
      <td>${it.description}
        <div class="muted small">${FEE_KIND_LABELS[it.kind]}${it.include_in_split ? '' : ' · excluded from split'}</div></td>
      <td class="num">${money(it.net_cents, it.currency)}</td>
      <td class="num">${money(it.gst_cents, it.currency)}
        <div class="muted small">${it.gst_treatment === 'none' ? 'no GST' : `${(it.gst_rate_bp / 100).toFixed(2)}% ${it.gst_treatment}`}</div></td>
      <td class="num strong">${money(it.gross_cents, it.currency)}</td>
      <td>${badge(FEE_STATUS_LABELS[it.status], statusTone(it.status === 'paid' ? 'approved' : it.status))}</td>
      <td>${canWrite ? html`
        <form method="post" action="/cases/${caseId}/fees/${it.id}/status" class="inline-form">
          ${csrfField(csrf)}
          <select name="status" class="js-autosubmit" aria-label="Fee status">
            ${FEE_STATUSES.map((s) => html`<option value="${s}" ${s === it.status ? raw('selected') : ''}>${FEE_STATUS_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-small btn-secondary js-hide" type="submit">Set</button>
        </form>
        <form method="post" action="/cases/${caseId}/fees/${it.id}/delete" class="inline-form"
              data-confirm="Delete this fee line?">
          ${csrfField(csrf)}
          <button class="btn btn-small btn-link-danger" type="submit">Delete</button>
        </form>` : ''}</td>
    </tr>`);

  const totalsRow = html`
    <tr class="totals-row">
      <td class="strong">Totals</td>
      <td class="num strong">${money(totals.totalNet, currency)}</td>
      <td class="num strong">${money(totals.totalGst, currency)}</td>
      <td class="num strong">${money(totals.totalGross, currency)}</td>
      <td colspan="2" class="small muted">
        Professional ${money(totals.professionalGross, currency)} ·
        Disbursements ${money(totals.disbursementsGross, currency)}
      </td>
    </tr>`;

  return card('Fees and split', html`
    <div class="fee-summary">
      <div class="stat"><span class="stat-label">Total (incl. GST)</span><span class="stat-value">${money(totals.totalGross, currency)}</span></div>
      <div class="stat"><span class="stat-label">GST</span><span class="stat-value">${money(totals.totalGst, currency)}</span></div>
      <div class="stat"><span class="stat-label">Invoiced</span><span class="stat-value">${money(totals.invoicedGross, currency)}</span></div>
      <div class="stat"><span class="stat-label">Paid</span><span class="stat-value">${money(totals.paidGross, currency)}</span></div>
      <div class="stat ${totals.outstandingGross > 0 ? 'stat-warn' : ''}">
        <span class="stat-label">Outstanding</span><span class="stat-value">${money(totals.outstandingGross, currency)}</span></div>
    </div>

    ${table(['Line', 'Net', 'GST', 'Gross', 'Status', ''], [...itemRows, totalsRow])}

    ${canWrite ? html`
    <details class="add-block">
      <summary>Add a fee line</summary>
      <form method="post" action="/cases/${caseId}/fees" class="row-form">
        ${csrfField(csrf)}
        ${field({ label: 'Description', name: 'description', required: true, maxlength: 200,
                  placeholder: 'e.g. AEWV application — professional fee' })}
        ${field({ label: 'Amount', name: 'amount', required: true, placeholder: '2500.00' })}
        ${select({ label: 'Type', name: 'kind', value: 'professional', includeBlank: false,
                   options: optionsFrom(FEE_KINDS, FEE_KIND_LABELS) })}
        ${select({ label: 'GST', name: 'gst_treatment', value: settings.gstRegistered ? settings.defaultTreatment : 'none',
                   includeBlank: false, options: optionsFrom(GST_TREATMENTS, GST_TREATMENT_LABELS) })}
        ${select({ label: 'Status', name: 'status', value: 'quoted', includeBlank: false,
                   options: optionsFrom(FEE_STATUSES, FEE_STATUS_LABELS) })}
        <div class="field checkbox-field">
          <label><input type="checkbox" name="include_in_split" checked> Include in the revenue split</label>
          <p class="hint">Leave unticked for disbursements you merely pass through.</p>
        </div>
        <button class="btn btn-primary" type="submit">Add fee line</button>
      </form>
    </details>` : ''}

    <h3 class="split-head">Split — ${SPLIT_BASE_LABELS[settings.splitBase]}</h3>
    <p class="muted small">Base for the split: <strong>${money(totals.splitBaseCents, currency)}</strong></p>
    ${table(['Party', 'Share', 'Amount'], [
      ...allocation.map((a) => html`
        <tr>
          <td>${a.label}<div class="muted small"><code>${a.party_key}</code></div></td>
          <td class="num">${formatBp(a.percent_bp)}</td>
          <td class="num strong">${money(a.amount_cents, currency)}</td>
        </tr>`),
      html`<tr class="totals-row">
        <td class="strong">Allocated</td>
        <td class="num strong ${bpTotal !== 10000 ? 'warn' : ''}">${formatBp(bpTotal)}</td>
        <td class="num strong">${money(totals.splitBaseCents - unallocated, currency)}</td>
      </tr>`,
      ...(unallocated !== 0
        ? [html`<tr><td colspan="2" class="warn">Unallocated</td><td class="num warn">${money(unallocated, currency)}</td></tr>`]
        : []),
    ])}
    ${bpTotal !== 10000
      ? html`<p class="alert alert-warn">Shares total ${formatBp(bpTotal)}, not 100%. Adjust them below.</p>`
      : ''}

    ${canWrite ? html`
    <details class="add-block">
      <summary>Adjust the split</summary>
      <form method="post" action="/cases/${caseId}/fees/shares">
        ${csrfField(csrf)}
        <table class="edit-table">
          <thead><tr><th>Label</th><th>Key</th><th>Percent</th><th></th></tr></thead>
          <tbody>
            ${shares.map((s) => html`
              <tr>
                <td><input name="label_${s.id}" value="${s.label}" maxlength="80"></td>
                <td><code>${s.party_key}</code></td>
                <td><input name="percent_${s.id}" value="${(s.percent_bp / 100).toString()}" inputmode="decimal" size="6">%</td>
                <td><label class="small"><input type="checkbox" name="remove_${s.id}"> remove</label></td>
              </tr>`)}
            <tr>
              <td><input name="new_label" placeholder="New party (optional)" maxlength="80"></td>
              <td><input name="new_key" placeholder="key" maxlength="40"></td>
              <td><input name="new_percent" placeholder="0" inputmode="decimal" size="6">%</td>
              <td></td>
            </tr>
          </tbody>
        </table>
        <button class="btn btn-primary" type="submit">Save split</button>
        <p class="hint">Percentages should total 100%. Amounts are allocated to the cent — leftover
          cents go to the largest remainders, so the parts always add back to the base.</p>
      </form>
    </details>` : ''}`);
}

export const feesModule: AppModule = {
  name: 'fees',
  title: 'Fees',
  basePaths: ['/cases/:id/fees', '/fees'],
  nav: [{ href: '/fees', label: 'Fees', permission: 'register:read', order: 40 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.post('/cases/:caseId/fees', requirePermission('register:write'), async (c) => {
      const caseId = c.req.param('caseId')!;
      const kase = await one<{ id: string; ref: string; currency: string }>(
        c.env.DB, 'SELECT id, ref, currency FROM cases WHERE id = ?', caseId,
      );
      if (!kase) return c.notFound();

      const settings = await feeSettings(c.env);
      const f = new FormReader(await c.req.formData());
      const description = f.text('description', { required: true, label: 'Description', max: 200 });
      const amount = f.money('amount', { required: true, label: 'Amount' });
      const kind = f.enum('kind', FEE_KINDS, { fallback: 'professional' })!;
      const treatment = f.enum('gst_treatment', GST_TREATMENTS, { fallback: settings.defaultTreatment })!;
      const status = f.enum('status', FEE_STATUSES, { fallback: 'quoted' })!;
      const includeInSplit = f.bool('include_in_split');
      if (!f.valid || amount === null) {
        return redirectWith(c, `/cases/${caseId}`, Object.values(f.errors)[0] ?? 'Invalid fee line.', 'err');
      }

      const rateBp = settings.gstRegistered ? settings.gstRateBp : 0;
      const { net, gst, gross } = computeGst(amount, treatment, rateBp);
      const id = newId('fee');
      await run(
        c.env.DB,
        `INSERT INTO fee_items (id, case_id, description, kind, amount_cents, gst_treatment, gst_rate_bp,
            net_cents, gst_cents, gross_cents, currency, include_in_split, status, invoiced_at, paid_at,
            created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, caseId, description, kind, amount, treatment, rateBp,
        net, gst, gross, kase.currency, includeInSplit, status,
        status === 'invoiced' || status === 'paid' ? nowIso() : null,
        status === 'paid' ? nowIso() : null,
        nowIso(), nowIso(), c.get('user')!.id,
      );
      await addEntry(c.env, {
        entityType: 'case', entityId: caseId, kind: 'system',
        body: `Fee line added: ${description} — ${money(gross, kase.currency)} incl. GST.`,
        createdBy: c.get('user')!.id,
      });
      await auditFrom(c, { action: 'fee.created', entityType: 'case', entityId: caseId, meta: { id, gross } });
      return redirectWith(c, `/cases/${caseId}`, 'Fee line added.');
    });

    r.post('/cases/:caseId/fees/:feeId/status', requirePermission('register:write'), async (c) => {
      const { caseId, feeId } = c.req.param();
      const f = new FormReader(await c.req.formData());
      const status = f.enum('status', FEE_STATUSES, { required: true });
      if (!status) return redirectWith(c, `/cases/${caseId}`, 'Unknown fee status.', 'err');

      const item = await one<FeeItemRow>(c.env.DB, 'SELECT * FROM fee_items WHERE id = ? AND case_id = ?', feeId, caseId);
      if (!item) return c.notFound();

      await run(
        c.env.DB,
        `UPDATE fee_items SET status = ?, invoiced_at = COALESCE(invoiced_at, ?), paid_at = ?, updated_at = ?
          WHERE id = ?`,
        status,
        status === 'invoiced' || status === 'paid' ? nowIso() : null,
        status === 'paid' ? (item.paid_at ?? nowIso()) : null,
        nowIso(), feeId,
      );
      await auditFrom(c, { action: 'fee.status_changed', entityType: 'case', entityId: caseId, meta: { feeId, status } });
      return redirectWith(c, `/cases/${caseId}`, `Fee line marked ${FEE_STATUS_LABELS[status]}.`);
    });

    r.post('/cases/:caseId/fees/:feeId/delete', requirePermission('register:delete'), async (c) => {
      const { caseId, feeId } = c.req.param();
      await run(c.env.DB, 'DELETE FROM fee_items WHERE id = ? AND case_id = ?', feeId, caseId);
      await auditFrom(c, { action: 'fee.deleted', entityType: 'case', entityId: caseId, meta: { feeId } });
      return redirectWith(c, `/cases/${caseId}`, 'Fee line deleted.');
    });

    r.post('/cases/:caseId/fees/shares', requirePermission('register:write'), async (c) => {
      const caseId = c.req.param('caseId')!;
      const shares = await ensureShares(c.env, caseId);
      const form = await c.req.formData();
      const f = new FormReader(form);

      const statements: D1PreparedStatement[] = [];
      for (const s of shares) {
        if (form.get(`remove_${s.id}`)) {
          statements.push(c.env.DB.prepare('DELETE FROM fee_shares WHERE id = ?').bind(s.id));
          continue;
        }
        const label = f.text(`label_${s.id}`, { max: 80 }) || s.label;
        const bp = parsePercentToBp(String(form.get(`percent_${s.id}`) ?? ''));
        if (bp === null) return redirectWith(c, `/cases/${caseId}`, `"${s.label}" needs a percentage between 0 and 100.`, 'err');
        statements.push(
          c.env.DB.prepare('UPDATE fee_shares SET label = ?, percent_bp = ?, updated_at = ? WHERE id = ?')
            .bind(label, bp, nowIso(), s.id),
        );
      }

      const newLabel = f.optional('new_label', { max: 80 });
      if (newLabel) {
        const rawKey = f.optional('new_key', { max: 40 }) ?? newLabel;
        const key = rawKey.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'party';
        const bp = parsePercentToBp(String(form.get('new_percent') ?? '0')) ?? 0;
        if (shares.some((s) => s.party_key === key)) {
          return redirectWith(c, `/cases/${caseId}`, `A party with key "${key}" already exists on this case.`, 'err');
        }
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO fee_shares (id, case_id, party_key, label, percent_bp, position, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?)`,
          ).bind(newId('shr'), caseId, key, newLabel, bp, shares.length, nowIso(), nowIso()),
        );
      }

      if (statements.length > 0) await c.env.DB.batch(statements);
      await auditFrom(c, { action: 'fee.split_updated', entityType: 'case', entityId: caseId });
      return redirectWith(c, `/cases/${caseId}`, 'Split updated.');
    });

    r.get('/fees', requirePermission('register:read'), async (c) => {
      const from = c.req.query('from') || '';
      const to = c.req.query('to') || '';
      const params: unknown[] = [];
      const conds: string[] = [];
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { conds.push('fi.created_at >= ?'); params.push(from); }
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { conds.push('fi.created_at <= ?'); params.push(`${to}T23:59:59.999Z`); }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await all<FeeItemRow & { case_ref: string; case_title: string; client_name: string }>(
        c.env.DB,
        `SELECT fi.*, k.ref AS case_ref, k.title AS case_title, cl.full_name AS client_name
           FROM fee_items fi
           JOIN cases k ON k.id = fi.case_id
           JOIN clients cl ON cl.id = k.client_id
           ${whereSql}
          ORDER BY fi.created_at DESC LIMIT 500`,
        ...params,
      );

      const settings = await feeSettings(c.env);
      const totals = summariseFees(rows, settings.splitBase);

      // Split totals are computed per case, because each case may carry its own
      // percentages — summing everything and splitting once would be wrong.
      const byCase = new Map<string, FeeItemRow[]>();
      for (const row of rows) {
        const list = byCase.get(row.case_id) ?? [];
        list.push(row);
        byCase.set(row.case_id, list);
      }
      const partyTotals = new Map<string, { label: string; amount: number }>();
      for (const [caseId, items] of byCase) {
        const shares = await all<FeeShareRow>(
          c.env.DB, 'SELECT * FROM fee_shares WHERE case_id = ? ORDER BY position, rowid', caseId,
        );
        if (shares.length === 0) continue;
        const caseTotals = summariseFees(items, settings.splitBase);
        for (const a of allocateSplit(caseTotals.splitBaseCents, shares)) {
          const cur = partyTotals.get(a.party_key) ?? { label: a.label, amount: 0 };
          cur.amount += a.amount_cents;
          partyTotals.set(a.party_key, cur);
        }
      }

      return page(c, { title: 'Fees', active: '/fees' }, html`
        ${pageHeader('Fees', 'Billed work across the practice, and how it splits.')}
        <form method="get" action="/fees" class="filters">
          <label class="small">From <input type="date" name="from" value="${from}"></label>
          <label class="small">To <input type="date" name="to" value="${to}"></label>
          <button class="btn btn-secondary" type="submit">Apply</button>
        </form>

        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Net</span><span class="stat-value">${money(totals.totalNet)}</span></div>
          <div class="stat"><span class="stat-label">GST</span><span class="stat-value">${money(totals.totalGst)}</span></div>
          <div class="stat"><span class="stat-label">Gross</span><span class="stat-value">${money(totals.totalGross)}</span></div>
          <div class="stat"><span class="stat-label">Paid</span><span class="stat-value">${money(totals.paidGross)}</span></div>
          <div class="stat ${totals.outstandingGross > 0 ? 'stat-warn' : ''}">
            <span class="stat-label">Outstanding</span><span class="stat-value">${money(totals.outstandingGross)}</span></div>
        </div>

        ${card('Split by party', table(['Party', 'Amount'],
          [...partyTotals.entries()].map(([key, v]) => html`
            <tr><td>${v.label} <span class="muted small"><code>${key}</code></span></td>
                <td class="num strong">${money(v.amount)}</td></tr>`)))}

        ${card('Fee lines', table(['Date', 'Case', 'Client', 'Line', 'Net', 'GST', 'Gross', 'Status'],
          rows.map((row) => html`
            <tr>
              <td class="small">${dateShort(row.created_at)}</td>
              <td><a href="/cases/${row.case_id}"><code>${row.case_ref}</code></a></td>
              <td class="small">${row.client_name}</td>
              <td class="small">${row.description}</td>
              <td class="num">${money(row.net_cents, row.currency)}</td>
              <td class="num">${money(row.gst_cents, row.currency)}</td>
              <td class="num strong">${money(row.gross_cents, row.currency)}</td>
              <td>${badge(FEE_STATUS_LABELS[row.status], statusTone(row.status === 'paid' ? 'approved' : row.status))}</td>
            </tr>`)))}`);
    });

    app.route('/', r);
  },
};
