/**
 * Module: inquiries.
 *
 * Everything that arrives before there is a client: an email, a forwarded
 * WhatsApp message, a phone call. An inquiry can be answered, quoted, declined
 * — or converted, in one step, into a client and an open case.
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
  badge, card, csrfField, emptyState, errorList, field, optionsFrom,
  pageHeader, select, statusTone, table,
} from '../../ui/components';
import { dateInputValue, dateShort, dateTime, truncate } from '../../ui/format';
import {
  CASE_STATUS_LABELS, ENTRY_KIND_LABELS, ENTRY_KINDS,
  INQUIRY_SOURCE_LABELS, INQUIRY_SOURCES, INQUIRY_STATUS_LABELS, INQUIRY_STATUSES,
  type InquirySource, type InquiryStatus,
} from '../../domain';
import { clientOptions, userOptions } from '../../core/lookups';
import { addEntry, listEntries } from '../../core/timeline';
import { can } from '../../core/rbac';
import { caseTypes, isTerm, labelFor, termOptions } from '../../core/vocabulary';

export interface InquiryRow {
  id: string; ref: string; source: InquirySource; source_ref: string | null; received_at: string;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  subject: string | null; body: string | null; status: InquiryStatus;
  client_id: string | null; case_id: string | null; assigned_to: string | null;
  ingest_message_id: string | null; created_at: string; updated_at: string;
}

/**
 * Create an inquiry. Shared with the ingest pipeline, which is why it takes
 * plain values rather than a request.
 */
export async function createInquiry(
  env: any,
  input: {
    source: InquirySource;
    sourceRef?: string | null;
    receivedAt?: string;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    subject?: string | null;
    body?: string | null;
    clientId?: string | null;
    createdBy?: string | null;
    ingestMessageId?: string | null;
  },
): Promise<{ id: string; ref: string }> {
  const id = newId('inq');
  const ref = await nextRef(env.DB, 'inquiry', 'ENQ');
  await run(
    env.DB,
    `INSERT INTO inquiries (id, ref, source, source_ref, received_at, contact_name, contact_email,
        contact_phone, subject, body, status, client_id, ingest_message_id, created_at, updated_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?)`,
    id, ref, input.source, input.sourceRef ?? null, input.receivedAt ?? nowIso(),
    input.contactName ?? null, input.contactEmail ?? null, input.contactPhone ?? null,
    input.subject ?? null, input.body ?? null, input.clientId ?? null,
    input.ingestMessageId ?? null, nowIso(), nowIso(), input.createdBy ?? null,
  );
  await addEntry(env, {
    entityType: 'inquiry', entityId: id, kind: 'system',
    body: `Inquiry ${ref} received via ${INQUIRY_SOURCE_LABELS[input.source]}.`,
    createdBy: input.createdBy ?? null,
  });
  return { id, ref };
}

/** Best-effort match of an incoming contact to an existing client. */
export async function matchClient(
  env: any,
  hints: { email?: string | null; phone?: string | null; telegramUserId?: string | null; whatsapp?: string | null },
): Promise<{ id: string; ref: string; full_name: string } | null> {
  const tries: Array<[string, string]> = [];
  if (hints.email) tries.push(['email = ?', hints.email.toLowerCase()]);
  if (hints.telegramUserId) tries.push(['telegram_user_id = ?', hints.telegramUserId]);
  if (hints.whatsapp) tries.push(['whatsapp = ?', hints.whatsapp.replace(/\D/g, '')]);
  if (hints.phone) tries.push(['REPLACE(REPLACE(phone, " ", ""), "-", "") = ?', hints.phone.replace(/[\s-]/g, '')]);

  for (const [clause, value] of tries) {
    const row = await one<{ id: string; ref: string; full_name: string }>(
      env.DB, `SELECT id, ref, full_name FROM clients WHERE ${clause} LIMIT 1`, value,
    );
    if (row) return row;
  }
  return null;
}

export const inquiriesModule: AppModule = {
  name: 'inquiries',
  title: 'Inquiries',
  basePaths: ['/inquiries'],
  nav: [{ href: '/inquiries', label: 'Inquiries', permission: 'register:read', order: 85 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const status = c.req.query('status') ?? '';
      const source = c.req.query('source') ?? '';
      const conds: string[] = [];
      const params: unknown[] = [];
      if ((INQUIRY_STATUSES as readonly string[]).includes(status)) { conds.push('i.status = ?'); params.push(status); }
      if ((INQUIRY_SOURCES as readonly string[]).includes(source)) { conds.push('i.source = ?'); params.push(source); }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const rows = await all<InquiryRow & { client_name: string | null }>(
        c.env.DB,
        `SELECT i.*, cl.full_name AS client_name FROM inquiries i
           LEFT JOIN clients cl ON cl.id = i.client_id
           ${whereSql} ORDER BY i.received_at DESC LIMIT 100`,
        ...params,
      );

      return page(c, { title: 'Inquiries', active: '/inquiries' }, html`
        ${pageHeader('Inquiries', 'New work coming in, from every channel.',
          can(c.get('user'), 'register:write') ? html`<a class="btn btn-primary" href="/inquiries/new">Record an inquiry</a>` : undefined)}
        <form method="get" action="/inquiries" class="filters">
          <select name="status"><option value="">All statuses</option>
            ${INQUIRY_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${INQUIRY_STATUS_LABELS[s]}</option>`)}
          </select>
          <select name="source"><option value="">All sources</option>
            ${INQUIRY_SOURCES.map((s) => html`<option value="${s}" ${s === source ? raw('selected') : ''}>${INQUIRY_SOURCE_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        ${table(['Reference', 'Received', 'From', 'Subject', 'Source', 'Status'], rows.map((row) => html`
          <tr>
            <td><a href="/inquiries/${row.id}"><code>${row.ref}</code></a></td>
            <td class="small">${dateShort(row.received_at)}</td>
            <td class="small">${row.client_name
              ? html`<a href="/clients/${row.client_id}">${row.client_name}</a>`
              : html`${row.contact_name ?? row.contact_email ?? row.contact_phone ?? '—'}`}</td>
            <td><a href="/inquiries/${row.id}">${truncate(row.subject ?? row.body, 70) || '(no subject)'}</a></td>
            <td class="small">${INQUIRY_SOURCE_LABELS[row.source] ?? row.source}</td>
            <td>${badge(INQUIRY_STATUS_LABELS[row.status] ?? row.status, statusTone(row.status))}</td>
          </tr>`))}`);
    });

    r.get('/new', requirePermission('register:write'), async (c) => {
      const csrf = c.get('session')!.csrf;
      const clients = await clientOptions(c.env);
      return page(c, { title: 'Record an inquiry', active: '/inquiries' }, html`
        ${breadcrumbs([{ href: '/inquiries', label: 'Inquiries' }, { label: 'New' }])}
        ${pageHeader('Record an inquiry')}
        <form method="post" action="/inquiries" class="form-grid">
          ${csrfField(csrf)}
          <div class="form-section">
            <h3>Where it came from</h3>
            ${select({ label: 'Source', name: 'source', value: 'phone', required: true, includeBlank: false,
                       options: optionsFrom(INQUIRY_SOURCES, INQUIRY_SOURCE_LABELS) })}
            ${field({ label: 'Received', name: 'received_at', type: 'date', value: nowIso().slice(0, 10) })}
            ${select({ label: 'Existing client (if known)', name: 'client_id', value: '', options: clients, includeBlank: 'Not an existing client' })}
          </div>
          <div class="form-section">
            <h3>Who</h3>
            ${field({ label: 'Name', name: 'contact_name', maxlength: 200 })}
            ${field({ label: 'Email', name: 'contact_email', type: 'email', maxlength: 320 })}
            ${field({ label: 'Phone', name: 'contact_phone', maxlength: 60 })}
          </div>
          <div class="form-section">
            <h3>What they asked</h3>
            ${field({ label: 'Subject', name: 'subject', maxlength: 200 })}
            ${field({ label: 'Details', name: 'body', type: 'textarea', rows: 6, maxlength: 10000 })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save inquiry</button>
            <a class="btn btn-secondary" href="/inquiries">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/', requirePermission('register:write'), async (c) => {
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const source = f.enum('source', INQUIRY_SOURCES, { required: true, label: 'Source' });
      const receivedAt = f.date('received_at');
      const clientId = f.optional('client_id', { max: 60 });
      const contactName = f.optional('contact_name', { max: 200 });
      const contactEmail = f.email('contact_email');
      const contactPhone = f.optional('contact_phone', { max: 60 });
      const subject = f.optional('subject', { max: 200 });
      const body = f.optional('body', { max: 10000 });
      if (!f.valid || !source) return redirectWith(c, '/inquiries/new', Object.values(f.errors)[0] ?? 'Invalid inquiry.', 'err');

      const { id, ref } = await createInquiry(c.env, {
        source, receivedAt: receivedAt ? `${receivedAt}T00:00:00.000Z` : nowIso(),
        contactName, contactEmail, contactPhone, subject, body,
        clientId: clientId || null, createdBy: user.id,
      });
      await auditFrom(c, { action: 'inquiry.created', entityType: 'inquiry', entityId: id, meta: { ref, source } });
      return redirectWith(c, `/inquiries/${id}`, `Inquiry ${ref} recorded.`);
    });

    r.get('/:id', requirePermission('register:read'), async (c) => {
      const types = await caseTypes(c.env);
      const id = c.req.param('id')!;
      const inq = await one<InquiryRow & { client_name: string | null; client_ref: string | null; case_ref: string | null }>(
        c.env.DB,
        `SELECT i.*, cl.full_name AS client_name, cl.ref AS client_ref, k.ref AS case_ref
           FROM inquiries i
           LEFT JOIN clients cl ON cl.id = i.client_id
           LEFT JOIN cases k ON k.id = i.case_id
          WHERE i.id = ?`,
        id,
      );
      if (!inq) return c.notFound();

      const [entries, clients, users, quotes] = await Promise.all([
        listEntries(c.env, 'inquiry', id),
        clientOptions(c.env),
        userOptions(c.env),
        all<any>(c.env.DB, 'SELECT id, ref, status FROM quotes WHERE inquiry_id = ? ORDER BY created_at DESC', id),
      ]);
      const csrf = c.get('session')!.csrf;
      const writable = can(c.get('user'), 'register:write');
      const suggested = inq.client_id ? null : await matchClient(c.env, { email: inq.contact_email, phone: inq.contact_phone });

      return page(c, { title: inq.ref, active: '/inquiries' }, html`
        ${breadcrumbs([{ href: '/inquiries', label: 'Inquiries' }, { label: inq.ref }])}
        ${pageHeader(inq.subject || `Inquiry ${inq.ref}`,
          `${inq.ref} · ${INQUIRY_SOURCE_LABELS[inq.source]} · received ${dateTime(inq.received_at)}`,
          writable
            ? html`<a class="btn btn-secondary" href="/inquiries/${inq.id}/edit">Edit</a>
                   ${inq.client_id
                     ? html`<a class="btn btn-secondary" href="/quotes/new?client_id=${inq.client_id}&inquiry_id=${inq.id}">Quote this</a>`
                     : ''}`
            : undefined)}

        <div class="cols">
          <div class="col-main">
            ${card('Message', html`<div class="prewrap message-body">${inq.body || '(no content)'}</div>`)}

            ${writable ? card('Convert to a case', inq.case_id
              ? html`<p>Converted to case <a href="/cases/${inq.case_id}"><code>${inq.case_ref}</code></a>.</p>`
              : html`
                <form method="post" action="/inquiries/${inq.id}/convert" class="row-form">
                  ${csrfField(csrf)}
                  ${select({ label: 'Client', name: 'client_id', value: inq.client_id ?? suggested?.id ?? '',
                             options: clients, includeBlank: 'Create a new client from this inquiry' })}
                  ${field({ label: 'New client name', name: 'new_client_name',
                            value: inq.contact_name ?? '', maxlength: 200,
                            hint: 'Used only when no existing client is chosen above.' })}
                  ${field({ label: 'Matter title', name: 'title', required: true, maxlength: 200,
                            value: inq.subject ?? '', placeholder: 'e.g. Partnership work visa' })}
                  ${select({ label: 'Case type', name: 'case_type', value: '', required: true,
                             options: termOptions(types), includeBlank: 'Choose a type' })}
                  ${select({ label: 'Assign to', name: 'assigned_to', value: '', options: users, includeBlank: 'Unassigned' })}
                  <button class="btn btn-primary" type="submit">Create client and case</button>
                  ${suggested ? html`<p class="hint">Matched an existing client by contact details:
                     <a href="/clients/${suggested.id}">${suggested.full_name}</a> (${suggested.ref}).</p>` : ''}
                </form>`) : ''}

            ${card('Timeline', html`
              ${writable ? html`
                <form method="post" action="/inquiries/${inq.id}/entries" class="entry-form">
                  ${csrfField(csrf)}
                  ${select({ label: 'Kind', name: 'kind', value: 'note', includeBlank: false,
                             options: optionsFrom(ENTRY_KINDS.filter((k) => k !== 'system') as any, ENTRY_KIND_LABELS as any) })}
                  ${field({ label: 'Entry', name: 'body', type: 'textarea', rows: 3, required: true, maxlength: 5000 })}
                  <button class="btn btn-primary" type="submit">Add</button>
                </form>` : ''}
              ${entries.length === 0 ? emptyState('Nothing recorded yet.') : html`
                <ul class="timeline">${entries.map((e) => html`
                  <li class="timeline-item">
                    <div class="timeline-meta">
                      ${badge(ENTRY_KIND_LABELS[e.kind] ?? e.kind, e.kind === 'system' ? 'grey' : 'neutral')}
                      <span class="muted small">${dateTime(e.occurred_at)}${e.author_name ? ` · ${e.author_name}` : ''}</span>
                    </div>
                    <div class="timeline-body">${e.body}</div>
                  </li>`)}</ul>`}`)}
          </div>

          <div class="col-side">
            ${card('Status', html`
              <p>${badge(INQUIRY_STATUS_LABELS[inq.status], statusTone(inq.status))}</p>
              ${writable ? html`
                <form method="post" action="/inquiries/${inq.id}/status" class="row-form">
                  ${csrfField(csrf)}
                  ${select({ label: 'Set status', name: 'status', value: inq.status, includeBlank: false,
                             options: optionsFrom(INQUIRY_STATUSES, INQUIRY_STATUS_LABELS) })}
                  <button class="btn btn-secondary" type="submit">Update</button>
                </form>` : ''}`)}

            ${card('Contact', html`
              <dl class="kv">
                <dt>Name</dt><dd>${inq.contact_name ?? '—'}</dd>
                <dt>Email</dt><dd>${inq.contact_email ? html`<a href="mailto:${inq.contact_email}">${inq.contact_email}</a>` : '—'}</dd>
                <dt>Phone</dt><dd>${inq.contact_phone ?? '—'}</dd>
                <dt>Client</dt><dd>${inq.client_id
                  ? html`<a href="/clients/${inq.client_id}">${inq.client_name}</a>`
                  : 'Not linked'}</dd>
                <dt>Channel ref</dt><dd class="small">${inq.source_ref ?? '—'}</dd>
              </dl>`)}

            ${card('Quotes', quotes.length === 0 ? emptyState('None raised.') : html`
              <ul class="list">${quotes.map((qt: any) => html`
                <li><a href="/quotes/${qt.id}"><code>${qt.ref}</code></a> <span class="muted small">${qt.status}</span></li>`)}</ul>`)}
          </div>
        </div>`);
    });

    r.get('/:id/edit', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const inq = await one<InquiryRow>(c.env.DB, 'SELECT * FROM inquiries WHERE id = ?', id);
      if (!inq) return c.notFound();

      const [clients, users] = await Promise.all([clientOptions(c.env), userOptions(c.env)]);
      const csrf = c.get('session')!.csrf;

      return page(c, { title: `Edit ${inq.ref}`, active: '/inquiries' }, html`
        ${breadcrumbs([{ href: '/inquiries', label: 'Inquiries' }, { href: `/inquiries/${inq.id}`, label: inq.ref }, { label: 'Edit' }])}
        ${pageHeader(`Edit ${inq.ref}`)}
        <form method="post" action="/inquiries/${inq.id}" class="form-grid">
          ${csrfField(csrf)}
          <div class="form-section">
            <h3>Where it came from</h3>
            ${select({ label: 'Source', name: 'source', value: inq.source, required: true, includeBlank: false,
                       options: optionsFrom(INQUIRY_SOURCES, INQUIRY_SOURCE_LABELS) })}
            ${field({ label: 'Received', name: 'received_at', type: 'date', value: dateInputValue(inq.received_at) })}
            ${select({ label: 'Client', name: 'client_id', value: inq.client_id ?? '', options: clients, includeBlank: 'Not an existing client' })}
            ${select({ label: 'Assigned to', name: 'assigned_to', value: inq.assigned_to ?? '', options: users, includeBlank: 'Unassigned' })}
          </div>
          <div class="form-section">
            <h3>Who</h3>
            ${field({ label: 'Name', name: 'contact_name', value: inq.contact_name, maxlength: 200 })}
            ${field({ label: 'Email', name: 'contact_email', type: 'email', value: inq.contact_email, maxlength: 320 })}
            ${field({ label: 'Phone', name: 'contact_phone', value: inq.contact_phone, maxlength: 60 })}
          </div>
          <div class="form-section">
            <h3>What they asked</h3>
            ${field({ label: 'Subject', name: 'subject', value: inq.subject, maxlength: 200 })}
            ${field({ label: 'Details', name: 'body', type: 'textarea', rows: 8, value: inq.body, maxlength: 10000,
                      hint: inq.ingest_message_id
                        ? 'This arrived through a channel. Editing changes the inquiry, not the captured original in the inbox.'
                        : undefined })}
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">Save changes</button>
            <a class="btn btn-secondary" href="/inquiries/${inq.id}">Cancel</a>
          </div>
        </form>`);
    });

    r.post('/:id', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const existing = await one<InquiryRow>(c.env.DB, 'SELECT * FROM inquiries WHERE id = ?', id);
      if (!existing) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const source = f.enum('source', INQUIRY_SOURCES, { required: true, label: 'Source' });
      const receivedAt = f.date('received_at');
      const clientId = f.optional('client_id', { max: 60 });
      const assignedTo = f.optional('assigned_to', { max: 60 });
      const contactName = f.optional('contact_name', { max: 200 });
      const contactEmail = f.email('contact_email');
      const contactPhone = f.optional('contact_phone', { max: 60 });
      const subject = f.optional('subject', { max: 200 });
      const body = f.optional('body', { max: 10000 });
      if (!f.valid || !source) {
        return redirectWith(c, `/inquiries/${id}/edit`, Object.values(f.errors)[0] ?? 'Invalid inquiry.', 'err');
      }

      await run(
        c.env.DB,
        `UPDATE inquiries SET source = ?, received_at = ?, client_id = ?, assigned_to = ?,
           contact_name = ?, contact_email = ?, contact_phone = ?, subject = ?, body = ?, updated_at = ?
         WHERE id = ?`,
        source,
        receivedAt ? `${receivedAt}T00:00:00.000Z` : existing.received_at,
        clientId || null, assignedTo || null,
        contactName, contactEmail, contactPhone, subject, body, nowIso(), id,
      );
      await auditFrom(c, { action: 'inquiry.updated', entityType: 'inquiry', entityId: id });
      return redirectWith(c, `/inquiries/${id}`, 'Inquiry updated.');
    });

    r.post('/:id/status', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const status = f.enum('status', INQUIRY_STATUSES, { required: true });
      if (!status) return redirectWith(c, `/inquiries/${id}`, 'Unknown status.', 'err');
      await run(c.env.DB, 'UPDATE inquiries SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), id);
      await addEntry(c.env, { entityType: 'inquiry', entityId: id, kind: 'system',
        body: `Status set to ${INQUIRY_STATUS_LABELS[status]}.`, createdBy: c.get('user')!.id });
      await auditFrom(c, { action: 'inquiry.status_changed', entityType: 'inquiry', entityId: id, meta: { status } });
      return redirectWith(c, `/inquiries/${id}`, 'Status updated.');
    });

    r.post('/:id/entries', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const f = new FormReader(await c.req.formData());
      const kind = f.enum('kind', ENTRY_KINDS, { fallback: 'note' })!;
      const body = f.text('body', { required: true, label: 'Entry', max: 5000 });
      if (!f.valid) return redirectWith(c, `/inquiries/${id}`, Object.values(f.errors)[0]!, 'err');
      await addEntry(c.env, { entityType: 'inquiry', entityId: id, kind, body, createdBy: c.get('user')!.id });
      await run(c.env.DB, 'UPDATE inquiries SET updated_at = ? WHERE id = ?', nowIso(), id);
      return redirectWith(c, `/inquiries/${id}`, 'Timeline updated.');
    });

    // Convert an inquiry into a client (if needed) and an open case, in one go.
    r.post('/:id/convert', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const inq = await one<InquiryRow>(c.env.DB, 'SELECT * FROM inquiries WHERE id = ?', id);
      if (!inq) return c.notFound();
      if (inq.case_id) return redirectWith(c, `/inquiries/${id}`, 'This inquiry has already been converted.', 'err');

      const f = new FormReader(await c.req.formData());
      const clientId = f.optional('client_id', { max: 60 });
      const newClientName = f.optional('new_client_name', { max: 200 });
      const title = f.text('title', { required: true, label: 'Matter title', max: 200 });
      const types = await caseTypes(c.env);
      const caseType = f.text('case_type', { required: true, label: 'Case type', max: 60 });
      if (caseType && !isTerm(types, caseType)) {
        return redirectWith(c, `/inquiries/${id}`, 'That is not one of the case types you have configured.', 'err');
      }
      const assignedTo = f.optional('assigned_to', { max: 60 });
      if (!f.valid || !caseType) return redirectWith(c, `/inquiries/${id}`, Object.values(f.errors)[0] ?? 'Invalid conversion.', 'err');

      let targetClientId = clientId || inq.client_id;
      if (!targetClientId) {
        const name = newClientName || inq.contact_name || inq.contact_email || 'Unnamed client';
        targetClientId = newId('cli');
        const clientRef = await nextRef(c.env.DB, 'client', 'CL');
        await run(
          c.env.DB,
          `INSERT INTO clients (id, ref, kind, full_name, email, phone, status, assigned_to, created_at, updated_at, created_by)
           VALUES (?,?,'individual',?,?,?,'prospect',?,?,?,?)`,
          targetClientId, clientRef, name, inq.contact_email, inq.contact_phone,
          assignedTo || null, nowIso(), nowIso(), user.id,
        );
        await addEntry(c.env, { entityType: 'client', entityId: targetClientId, kind: 'system',
          body: `Client created from inquiry ${inq.ref}.`, createdBy: user.id });
      }

      const caseId = newId('cas');
      const caseRef = await nextRef(c.env.DB, 'case', 'CASE');
      await run(
        c.env.DB,
        `INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, assigned_to,
            summary, currency, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,'lead','normal',?,?, 'NZD', ?,?,?)`,
        caseId, caseRef, targetClientId, title, caseType, assignedTo || null,
        inq.body ? `From inquiry ${inq.ref}:\n\n${inq.body}`.slice(0, 4000) : null,
        nowIso(), nowIso(), user.id,
      );
      await run(
        c.env.DB,
        'INSERT INTO case_status_history (id, case_id, from_status, to_status, at, by_user_id, note) VALUES (?,?,?,?,?,?,?)',
        newId('csh'), caseId, null, 'lead', nowIso(), user.id, `Converted from inquiry ${inq.ref}`,
      );
      await run(
        c.env.DB,
        `UPDATE inquiries SET status = 'converted', client_id = ?, case_id = ?, updated_at = ? WHERE id = ?`,
        targetClientId, caseId, nowIso(), id,
      );
      await addEntry(c.env, { entityType: 'case', entityId: caseId, kind: 'system',
        body: `Case opened from inquiry ${inq.ref}.`, createdBy: user.id });
      await addEntry(c.env, { entityType: 'inquiry', entityId: id, kind: 'system',
        body: `Converted to case ${caseRef}.`, createdBy: user.id });
      await auditFrom(c, { action: 'inquiry.converted', entityType: 'inquiry', entityId: id,
        meta: { caseId, caseRef, clientId: targetClientId } });

      return redirectWith(c, `/cases/${caseId}`, `Case ${caseRef} opened from inquiry ${inq.ref}.`);
    });

    app.route('/inquiries', r);
  },
};
