/**
 * Module: clients.
 *
 * The person or organisation the practice acts for. A client owns cases,
 * quotes, inquiries and a timeline. Passport numbers are the one field held
 * encrypted at rest, and reading one is an audited action.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { all, nextRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { sealField, unsealField } from '../../core/crypto';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, errorList, field, optionsFrom,
  pageHeader, select, statusTone, table,
} from '../../ui/components';
import { dateInputValue, dateShort, dateTime, money, truncate } from '../../ui/format';
import {
  CASE_STATUS_LABELS, CASE_TYPE_LABELS, CLIENT_STATUSES, CLIENT_STATUS_LABELS,
  ENTRY_KINDS, ENTRY_KIND_LABELS, QUOTE_STATUS_LABELS, type ClientStatus,
} from '../../domain';
import { userOptions } from '../../core/lookups';
import { addEntry, listEntries } from '../../core/timeline';
import { can } from '../../core/rbac';

export interface ClientRow {
  id: string; ref: string; kind: string; full_name: string; preferred_name: string | null;
  email: string | null; phone: string | null; whatsapp: string | null;
  telegram_username: string | null; telegram_user_id: string | null;
  nationality: string | null; date_of_birth: string | null; passport_sealed: string | null;
  current_visa_type: string | null; current_visa_expiry: string | null;
  address: string | null; status: ClientStatus; assigned_to: string | null; notes: string | null;
  created_at: string; updated_at: string; created_by: string | null;
}

const PAGE_SIZE = 25;

function clientForm(c: any, values: Partial<ClientRow>, users: Array<{ value: string; label: string }>, errors?: Record<string, string>): Raw {
  const csrf = c.get('session').csrf;
  const sealingAvailable = Boolean(c.env.FIELD_KEY);
  const action = values.id ? `/clients/${values.id}` : '/clients';
  return html`
    ${errorList(errors)}
    <form method="post" action="${action}" class="form-grid">
      ${csrfField(csrf)}
      <div class="form-section">
        <h3>Identity</h3>
        ${select({ label: 'Record type', name: 'kind', value: values.kind ?? 'individual', includeBlank: false,
                   options: [{ value: 'individual', label: 'Individual' }, { value: 'organisation', label: 'Organisation' }] })}
        ${field({ label: 'Full legal name', name: 'full_name', value: values.full_name, required: true, maxlength: 200 })}
        ${field({ label: 'Preferred name', name: 'preferred_name', value: values.preferred_name, maxlength: 120 })}
        ${field({ label: 'Nationality', name: 'nationality', value: values.nationality, maxlength: 100 })}
        ${field({ label: 'Date of birth', name: 'date_of_birth', type: 'date', value: dateInputValue(values.date_of_birth) })}
        ${sealingAvailable
          ? field({ label: 'Passport number', name: 'passport_number', value: '',
                    hint: values.passport_sealed
                      ? 'A passport number is on file (encrypted). Enter a new one to replace it, or leave blank to keep it.'
                      : 'Stored encrypted at rest. Leave blank if not needed.' })
          : html`<div class="field"><label>Passport number</label>
                 <p class="hint">Disabled: set the <code>FIELD_KEY</code> secret to store passport numbers encrypted.</p></div>`}
      </div>

      <div class="form-section">
        <h3>Contact</h3>
        ${field({ label: 'Email', name: 'email', type: 'email', value: values.email, maxlength: 320 })}
        ${field({ label: 'Phone', name: 'phone', value: values.phone, maxlength: 60 })}
        ${field({ label: 'WhatsApp number', name: 'whatsapp', value: values.whatsapp, maxlength: 60,
                  hint: 'E.164 without the plus, e.g. 6421234567. Used to match incoming WhatsApp messages.' })}
        ${field({ label: 'Telegram username', name: 'telegram_username', value: values.telegram_username, maxlength: 60 })}
        ${field({ label: 'Telegram user ID', name: 'telegram_user_id', value: values.telegram_user_id, maxlength: 40,
                  hint: 'Numeric ID. Used to match forwarded Telegram messages.' })}
        ${field({ label: 'Address', name: 'address', type: 'textarea', value: values.address, rows: 3, maxlength: 500 })}
      </div>

      <div class="form-section">
        <h3>Immigration status</h3>
        ${field({ label: 'Current visa type', name: 'current_visa_type', value: values.current_visa_type, maxlength: 120 })}
        ${field({ label: 'Current visa expiry', name: 'current_visa_expiry', type: 'date', value: dateInputValue(values.current_visa_expiry) })}
      </div>

      <div class="form-section">
        <h3>File management</h3>
        ${select({ label: 'Status', name: 'status', value: values.status ?? 'prospect', includeBlank: false,
                   options: optionsFrom(CLIENT_STATUSES, CLIENT_STATUS_LABELS) })}
        ${select({ label: 'Assigned to', name: 'assigned_to', value: values.assigned_to ?? '', options: users, includeBlank: 'Unassigned' })}
        ${field({ label: 'General notes', name: 'notes', type: 'textarea', value: values.notes, rows: 4, maxlength: 4000 })}
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${values.id ? 'Save changes' : 'Create client'}</button>
        <a class="btn btn-secondary" href="${values.id ? `/clients/${values.id}` : '/clients'}">Cancel</a>
      </div>
    </form>`;
}

function readClientForm(f: FormReader) {
  return {
    kind: f.enum('kind', ['individual', 'organisation'] as const, { fallback: 'individual' })!,
    full_name: f.text('full_name', { required: true, label: 'Full legal name', max: 200 }),
    preferred_name: f.optional('preferred_name', { max: 120 }),
    email: f.email('email'),
    phone: f.optional('phone', { max: 60 }),
    whatsapp: f.optional('whatsapp', { max: 60 }),
    telegram_username: f.optional('telegram_username', { max: 60 }),
    telegram_user_id: f.optional('telegram_user_id', { max: 40, pattern: /^\d+$/, patternMessage: 'Telegram user ID must be numeric.' }),
    nationality: f.optional('nationality', { max: 100 }),
    date_of_birth: f.date('date_of_birth'),
    current_visa_type: f.optional('current_visa_type', { max: 120 }),
    current_visa_expiry: f.date('current_visa_expiry'),
    address: f.optional('address', { max: 500 }),
    status: f.enum('status', CLIENT_STATUSES, { fallback: 'prospect' })!,
    assigned_to: f.optional('assigned_to', { max: 60 }),
    notes: f.optional('notes', { max: 4000 }),
    passport_number: f.optional('passport_number', { max: 60 }),
  };
}

export const clientsModule: AppModule = {
  name: 'clients',
  title: 'Clients',
  basePaths: ['/clients'],
  nav: [{ href: '/clients', label: 'Clients', permission: 'register:read', order: 90 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // --- List ---------------------------------------------------------------
    r.get('/', requirePermission('register:read'), async (c) => {
      const q = (c.req.query('q') ?? '').trim();
      const status = c.req.query('status') ?? '';
      const pageNum = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
      const offset = (pageNum - 1) * PAGE_SIZE;

      const where: string[] = [];
      const params: unknown[] = [];
      if (q) {
        where.push('(full_name LIKE ?1 OR email LIKE ?1 OR phone LIKE ?1 OR ref LIKE ?1 OR preferred_name LIKE ?1)');
        params.push(`%${q}%`);
      }
      if (status && (CLIENT_STATUSES as readonly string[]).includes(status)) {
        where.push(`status = ?${params.length + 1}`);
        params.push(status);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = await all<ClientRow & { open_cases: number }>(
        c.env.DB,
        `SELECT c.*, (SELECT COUNT(*) FROM cases k WHERE k.client_id = c.id AND k.closed_at IS NULL) AS open_cases
           FROM clients c ${whereSql}
          ORDER BY c.updated_at DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`,
        ...params, PAGE_SIZE + 1, offset,
      );
      const hasMore = rows.length > PAGE_SIZE;
      const shown = rows.slice(0, PAGE_SIZE);

      return page(c, { title: 'Clients', active: '/clients' }, html`
        ${pageHeader('Clients', 'Everyone the practice acts for.',
          can(c.get('user'), 'register:write') ? html`<a class="btn btn-primary" href="/clients/new">New client</a>` : undefined)}
        <form method="get" action="/clients" class="filters">
          <input type="search" name="q" value="${q}" placeholder="Search name, email, phone or reference">
          <select name="status">
            <option value="">All statuses</option>
            ${CLIENT_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${CLIENT_STATUS_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        ${table(['Reference', 'Name', 'Contact', 'Status', 'Open cases', 'Updated'], shown.map((row) => html`
          <tr>
            <td><a href="/clients/${row.id}"><code>${row.ref}</code></a></td>
            <td><a href="/clients/${row.id}">${row.full_name}</a>
                ${row.nationality ? html`<div class="muted small">${row.nationality}</div>` : ''}</td>
            <td class="small">${row.email ?? ''}${row.email && row.phone ? raw('<br>') : ''}${row.phone ?? ''}</td>
            <td>${badge(CLIENT_STATUS_LABELS[row.status], statusTone(row.status))}</td>
            <td>${row.open_cases || '—'}</td>
            <td class="small">${dateShort(row.updated_at)}</td>
          </tr>`))}
        <div class="pager">
          ${pageNum > 1 ? html`<a class="btn btn-secondary" href="/clients?q=${q}&status=${status}&page=${pageNum - 1}">Previous</a>` : ''}
          ${hasMore ? html`<a class="btn btn-secondary" href="/clients?q=${q}&status=${status}&page=${pageNum + 1}">Next</a>` : ''}
        </div>`);
    });

    // --- Create -------------------------------------------------------------
    r.get('/new', requirePermission('register:write'), async (c) => {
      const users = await userOptions(c.env);
      return page(c, { title: 'New client', active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { label: 'New' }])}
        ${pageHeader('New client')}
        ${clientForm(c, {}, users)}`);
    });

    r.post('/', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const v = readClientForm(f);
      if (!f.valid) {
        const users = await userOptions(c.env);
        return page(c, { title: 'New client', active: '/clients', status: 400 }, html`
          ${pageHeader('New client')}${clientForm(c, v as Partial<ClientRow>, users, f.errors)}`);
      }

      const id = newId('cli');
      const ref = await nextRef(c.env.DB, 'client', 'CL');
      const passportSealed = v.passport_number && c.env.FIELD_KEY
        ? await sealField(v.passport_number, c.env.FIELD_KEY)
        : null;

      await run(
        c.env.DB,
        `INSERT INTO clients (id, ref, kind, full_name, preferred_name, email, phone, whatsapp,
            telegram_username, telegram_user_id, nationality, date_of_birth, passport_sealed,
            current_visa_type, current_visa_expiry, address, status, assigned_to, notes,
            created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id, ref, v.kind, v.full_name, v.preferred_name, v.email, v.phone, v.whatsapp,
        v.telegram_username, v.telegram_user_id, v.nationality, v.date_of_birth, passportSealed,
        v.current_visa_type, v.current_visa_expiry, v.address, v.status, v.assigned_to || null, v.notes,
        nowIso(), nowIso(), user.id,
      );
      await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system', body: `Client record created (${ref}).`, createdBy: user.id });
      await auditFrom(c, { action: 'client.created', entityType: 'client', entityId: id, meta: { ref } });
      return redirectWith(c, `/clients/${id}`, `Client ${ref} created.`);
    });

    // --- Detail -------------------------------------------------------------
    r.get('/:id', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const client = await one<ClientRow & { assignee_name: string | null }>(
        c.env.DB,
        `SELECT c.*, u.name AS assignee_name FROM clients c
           LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = ?`,
        id,
      );
      if (!client) return c.notFound();

      const [cases, quotes, inquiries, entries, tasks] = await Promise.all([
        all<any>(c.env.DB, `SELECT id, ref, title, case_type, status, priority, next_action, next_action_due, updated_at
                              FROM cases WHERE client_id = ? ORDER BY updated_at DESC`, id),
        all<any>(c.env.DB, `SELECT id, ref, description, amount_cents, gst_cents, disbursements_cents, currency, status, created_at
                              FROM quotes WHERE client_id = ? ORDER BY created_at DESC`, id),
        all<any>(c.env.DB, `SELECT id, ref, source, subject, status, received_at
                              FROM inquiries WHERE client_id = ? ORDER BY received_at DESC LIMIT 20`, id),
        listEntries(c.env, 'client', id),
        all<any>(c.env.DB, `SELECT id, title, status, due_at FROM tasks
                             WHERE entity_type = 'client' AND entity_id = ? AND status IN ('open','in_progress','blocked')
                             ORDER BY due_at`, id),
      ]);

      const csrf = c.get('session')!.csrf;
      const writable = can(c.get('user'), 'register:write');

      return page(c, { title: client.full_name, active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { label: client.ref }])}
        ${pageHeader(client.full_name,
          `${client.ref} · ${CLIENT_STATUS_LABELS[client.status]}${client.assignee_name ? ` · ${client.assignee_name}` : ''}`,
          writable ? html`
            <a class="btn btn-secondary" href="/clients/${client.id}/edit">Edit</a>
            <a class="btn btn-primary" href="/cases/new?client_id=${client.id}">New case</a>
            <a class="btn btn-secondary" href="/quotes/new?client_id=${client.id}">New quote</a>` : undefined)}

        <div class="cols">
          <div class="col-main">
            ${card('Cases', table(['Reference', 'Matter', 'Type', 'Status', 'Next action'], cases.map((k: any) => html`
              <tr>
                <td><a href="/cases/${k.id}"><code>${k.ref}</code></a></td>
                <td><a href="/cases/${k.id}">${k.title}</a></td>
                <td class="small">${CASE_TYPE_LABELS[k.case_type as keyof typeof CASE_TYPE_LABELS] ?? k.case_type}</td>
                <td>${badge(CASE_STATUS_LABELS[k.status as keyof typeof CASE_STATUS_LABELS] ?? k.status, statusTone(k.status))}</td>
                <td class="small">${k.next_action ? html`${truncate(k.next_action, 60)}<div class="muted">${dateShort(k.next_action_due)}</div>` : '—'}</td>
              </tr>`)))}

            ${card('Quotes', table(['Reference', 'Description', 'Total', 'Status', 'Raised'], quotes.map((qt: any) => html`
              <tr>
                <td><a href="/quotes/${qt.id}"><code>${qt.ref}</code></a></td>
                <td>${truncate(qt.description, 70)}</td>
                <td>${money(qt.amount_cents + qt.gst_cents + qt.disbursements_cents, qt.currency)}</td>
                <td>${badge(QUOTE_STATUS_LABELS[qt.status as keyof typeof QUOTE_STATUS_LABELS] ?? qt.status, statusTone(qt.status))}</td>
                <td class="small">${dateShort(qt.created_at)}</td>
              </tr>`)))}

            ${card('Timeline', html`
              ${writable ? html`
              <form method="post" action="/clients/${client.id}/entries" class="entry-form">
                ${csrfField(csrf)}
                <div class="row">
                  ${select({ label: 'Kind', name: 'kind', value: 'note', includeBlank: false,
                             options: optionsFrom(ENTRY_KINDS.filter((k) => k !== 'system') as any, ENTRY_KIND_LABELS as any) })}
                </div>
                ${field({ label: 'Entry', name: 'body', type: 'textarea', rows: 3, required: true, maxlength: 5000,
                          placeholder: 'What happened, what was advised, what was agreed.' })}
                <button class="btn btn-primary" type="submit">Add to timeline</button>
              </form>` : ''}
              ${entries.length === 0 ? emptyState('No timeline entries yet.') : html`
                <ul class="timeline">
                  ${entries.map((e) => html`
                    <li class="timeline-item">
                      <div class="timeline-meta">
                        ${badge(ENTRY_KIND_LABELS[e.kind] ?? e.kind, e.kind === 'system' ? 'grey' : 'neutral')}
                        <span class="muted small">${dateTime(e.occurred_at)}${e.author_name ? ` · ${e.author_name}` : ''}</span>
                      </div>
                      <div class="timeline-body">${e.body}</div>
                    </li>`)}
                </ul>`}`)}
          </div>

          <div class="col-side">
            ${card('Contact', html`
              <dl class="kv">
                <dt>Email</dt><dd>${client.email ? html`<a href="mailto:${client.email}">${client.email}</a>` : '—'}</dd>
                <dt>Phone</dt><dd>${client.phone ?? '—'}</dd>
                <dt>WhatsApp</dt><dd>${client.whatsapp ?? '—'}</dd>
                <dt>Telegram</dt><dd>${client.telegram_username ?? client.telegram_user_id ?? '—'}</dd>
                <dt>Address</dt><dd>${client.address ?? '—'}</dd>
              </dl>`)}

            ${card('Immigration', html`
              <dl class="kv">
                <dt>Nationality</dt><dd>${client.nationality ?? '—'}</dd>
                <dt>Date of birth</dt><dd>${dateShort(client.date_of_birth)}</dd>
                <dt>Current visa</dt><dd>${client.current_visa_type ?? '—'}</dd>
                <dt>Visa expiry</dt><dd>${dateShort(client.current_visa_expiry)}</dd>
                <dt>Passport</dt><dd>${client.passport_sealed
                  ? html`<span class="muted">On file (encrypted)</span>
                         ${actionButton(`/clients/${client.id}/passport`, csrf, 'Reveal', { className: 'btn btn-small btn-secondary' })}`
                  : html`<span class="muted">—</span>`}</dd>
              </dl>`)}

            ${card('Open tasks', tasks.length === 0
              ? emptyState('Nothing outstanding.')
              : html`<ul class="list">${tasks.map((t: any) => html`
                  <li><a href="/tasks#${t.id}">${t.title}</a> <span class="muted small">${dateShort(t.due_at)}</span></li>`)}</ul>`)}

            ${card('Recent inquiries', inquiries.length === 0
              ? emptyState('None recorded.')
              : html`<ul class="list">${inquiries.map((i: any) => html`
                  <li><a href="/inquiries/${i.id}">${i.subject || i.ref}</a>
                      <span class="muted small">${dateShort(i.received_at)}</span></li>`)}</ul>`)}

            ${card('Notes', html`<p class="prewrap">${client.notes || '—'}</p>`)}
          </div>
        </div>`);
    });

    // --- Edit ---------------------------------------------------------------
    r.get('/:id/edit', requirePermission('register:write'), async (c) => {
      const client = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', c.req.param('id')!);
      if (!client) return c.notFound();
      const users = await userOptions(c.env);
      return page(c, { title: `Edit ${client.full_name}`, active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { href: `/clients/${client.id}`, label: client.ref }, { label: 'Edit' }])}
        ${pageHeader(`Edit ${client.full_name}`)}
        ${clientForm(c, client, users)}`);
    });

    r.post('/:id', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const existing = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!existing) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const v = readClientForm(f);
      if (!f.valid) {
        const users = await userOptions(c.env);
        return page(c, { title: 'Edit client', active: '/clients', status: 400 }, html`
          ${pageHeader(`Edit ${existing.full_name}`)}${clientForm(c, { ...existing, ...v } as Partial<ClientRow>, users, f.errors)}`);
      }

      const passportSealed = v.passport_number && c.env.FIELD_KEY
        ? await sealField(v.passport_number, c.env.FIELD_KEY)
        : existing.passport_sealed;

      await run(
        c.env.DB,
        `UPDATE clients SET kind=?, full_name=?, preferred_name=?, email=?, phone=?, whatsapp=?,
           telegram_username=?, telegram_user_id=?, nationality=?, date_of_birth=?, passport_sealed=?,
           current_visa_type=?, current_visa_expiry=?, address=?, status=?, assigned_to=?, notes=?, updated_at=?
         WHERE id=?`,
        v.kind, v.full_name, v.preferred_name, v.email, v.phone, v.whatsapp,
        v.telegram_username, v.telegram_user_id, v.nationality, v.date_of_birth, passportSealed,
        v.current_visa_type, v.current_visa_expiry, v.address, v.status, v.assigned_to || null, v.notes,
        nowIso(), id,
      );

      const changed = Object.entries(v)
        .filter(([k, val]) => k !== 'passport_number' && (existing as any)[k] !== val && !(val === null && (existing as any)[k] === null))
        .map(([k]) => k);
      if (existing.status !== v.status) {
        await addEntry(c.env, { entityType: 'client', entityId: id, kind: 'system',
          body: `Status changed from ${CLIENT_STATUS_LABELS[existing.status]} to ${CLIENT_STATUS_LABELS[v.status]}.`, createdBy: user.id });
      }
      await auditFrom(c, { action: 'client.updated', entityType: 'client', entityId: id, meta: { changed } });
      return redirectWith(c, `/clients/${id}`, 'Client updated.');
    });

    // Revealing a passport number is a separate, audited action, and the
    // response is never cached or reachable by a GET a browser might replay.
    r.post('/:id/passport', requirePermission('register:read'), async (c) => {
      const id = c.req.param('id')!;
      const client = await one<ClientRow>(c.env.DB, 'SELECT * FROM clients WHERE id = ?', id);
      if (!client) return c.notFound();
      if (!client.passport_sealed || !c.env.FIELD_KEY) {
        return redirectWith(c, `/clients/${id}`, 'No passport number on file.', 'err');
      }
      const value = await unsealField(client.passport_sealed, c.env.FIELD_KEY);
      await auditFrom(c, { action: 'client.passport_revealed', entityType: 'client', entityId: id });
      c.header('Cache-Control', 'no-store, private');
      return page(c, { title: 'Passport number', active: '/clients' }, html`
        ${breadcrumbs([{ href: '/clients', label: 'Clients' }, { href: `/clients/${id}`, label: client.ref }, { label: 'Passport' }])}
        ${pageHeader('Passport number', `${client.full_name} · this view has been recorded in the audit log`)}
        ${card('Value', value
          ? html`<p class="key-block"><code>${value}</code></p>`
          : html`<p class="alert alert-error">The stored value could not be decrypted with the current key.</p>`)}
        <p><a class="btn btn-secondary" href="/clients/${id}">Back to client</a></p>`);
    });

    r.post('/:id/entries', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const exists = await one<{ id: string }>(c.env.DB, 'SELECT id FROM clients WHERE id = ?', id);
      if (!exists) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const kind = f.enum('kind', ENTRY_KINDS, { fallback: 'note' })!;
      const body = f.text('body', { required: true, label: 'Entry', max: 5000 });
      if (!f.valid) return redirectWith(c, `/clients/${id}`, Object.values(f.errors)[0]!, 'err');

      await addEntry(c.env, { entityType: 'client', entityId: id, kind, body, createdBy: user.id });
      await run(c.env.DB, 'UPDATE clients SET updated_at = ? WHERE id = ?', nowIso(), id);
      await auditFrom(c, { action: 'client.entry_added', entityType: 'client', entityId: id, meta: { kind } });
      return redirectWith(c, `/clients/${id}`, 'Timeline updated.');
    });

    app.route('/clients', r);
  },
};
