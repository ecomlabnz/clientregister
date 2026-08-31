/**
 * Module: inquiries.
 *
 * Everything that arrives before there is a client: an email, a forwarded
 * WhatsApp message, a phone call. An inquiry can be answered, quoted, declined
 * — or converted, in one step, into a client and an open case.
 */

import { Hono } from 'hono';
import type { AppContext, Env, User } from '../../types';
import type { AppModule } from '../../core/module';
import { all, nextRef, nextYearlyRef, nowIso, one, run } from '../../core/db';
import { newId } from '../../core/ids';
import { requireAuth, requirePermission } from '../../core/auth';
import { auditFrom } from '../../core/audit';
import { FormReader } from '../../core/validate';
import { page, redirectWith, breadcrumbs } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import {
  actionButton, badge, card, csrfField, emptyState, errorList, field, optionsFrom, pageHeader, select, stamp, statusTone, table, timelineItem,
} from '../../ui/components';
import { dateInputValue, dateOrDateTime, dateShort, dateTime, truncate } from '../../ui/format';
import {
  CASE_STATUS_LABELS, ENTRY_KIND_LABELS, ENTRY_KINDS,
  INQUIRY_SOURCE_LABELS, INQUIRY_SOURCES, INQUIRY_STATUS_LABELS, INQUIRY_STATUSES,
  type InquirySource, type InquiryStatus,
} from '../../domain';
import { countryCodeFor, countryOptions } from '../../core/countries';
import { setNationalityStatements } from '../../core/nationalities';
import { clientOptions, isAssignable, userOptions } from '../../core/lookups';
import { composeFullName, familyNameFor, plainAscii, splitFullName } from '../../core/names';
import {
  CORRECTION_WINDOW_MINUTES, addEntry, correctable, listEntries,
} from '../../core/timeline';
import { openThreadCount } from '../../core/channels';
import { can } from '../../core/rbac';
import { caseTypes, isTerm, labelFor, termOptions } from '../../core/vocabulary';
import { fileOntoRecord, filingOptions, filingTargetLabel, markLinkedFiled, parseFilingChoice, unfile } from '../../core/filing';

export interface InquiryRow {
  id: string; ref: string; source: InquirySource; source_ref: string | null; received_at: string;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  subject: string | null; body: string | null; status: InquiryStatus;
  client_id: string | null; case_id: string | null; assigned_to: string | null;
  ingest_message_id: string | null; created_at: string; updated_at: string;
  filed_at: string | null; filed_by: string | null; filed_entry_id: string | null;
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

/**
 * The database's own words when it refuses a delete.
 *
 * Every refusal in migration 0036 is already a sentence a person can act on —
 * "an inquiry that has been quoted cannot be deleted" — so this lifts it out of
 * whatever D1 wrapped it in rather than keeping a second copy of the rule here
 * in TypeScript to go stale against the first.
 */
function refusal(err: unknown): string | null {
  const text = err instanceof Error ? err.message : String(err);
  const found = /an inquiry [^.:\n]*cannot be deleted/i.exec(text);
  if (!found) return null;
  const sentence = found[0]!;
  return `${sentence[0]!.toUpperCase()}${sentence.slice(1)}.`;
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

/**
 * The three surfaces of "what came in", and one bar across all of them.
 *
 * Inbox and Inquiries are different things and stay different things: the inbox
 * holds raw messages from a channel, untrusted outside text that nothing acts
 * on by itself; an inquiry is a work item with a reference, a status and an
 * owner. A twenty-message thread is still one inquiry, and an inquiry taken
 * over the phone has no message behind it at all. Merging the *data* would lose
 * that distinction.
 *
 * But nobody thinks "I will go to the Inbox" — they think "what came in". So
 * the three share one menu entry and one bar, and only the current tab moves.
 *
 * The counts are what is waiting on each, not how many rows exist: a number
 * beside a tab is only useful if it means "this much is asking for you".
 */
export interface IncomingCounts { inquiries: number; inbox: number; threads: number }

export async function incomingCounts(env: Env): Promise<IncomingCounts> {
  const [open, waiting, threads] = await Promise.all([
    one<{ n: number }>(
      env.DB,
      `SELECT COUNT(*) AS n FROM inquiries
        WHERE status IN ('new', 'triaged', 'responded', 'quoted') AND filed_at IS NULL`),
    one<{ n: number }>(
      env.DB, `SELECT COUNT(*) AS n FROM ingest_messages WHERE status = 'pending' AND filed_at IS NULL`),
    openThreadCount(env),
  ]);
  return { inquiries: open?.n ?? 0, inbox: waiting?.n ?? 0, threads };
}

export function incomingTabs(
  user: User | null, current: 'inquiries' | 'inbox' | 'threads', counts: IncomingCounts,
): Raw {
  // The inbox and the conversations are triage, which a read-only account does
  // not do. Their tabs are absent rather than disabled — a tab that refuses to
  // open is worse than one that was never offered.
  const triage = can(user, 'ingest:triage');
  const tabs = [
    { id: 'inquiries', label: 'Inquiries', href: '/inquiries', count: counts.inquiries, show: true },
    { id: 'inbox', label: 'Inbox', href: '/inbox', count: counts.inbox, show: triage },
    { id: 'threads', label: 'Conversations', href: '/inbox/threads', count: counts.threads, show: triage },
  ].filter((t) => t.show);

  return html`<nav class="tabs">${tabs.map((t) => html`
    <a class="${t.id === current ? 'tab current' : 'tab'}" href="${t.href}">${t.label}
      <span class="muted">${t.count}</span></a>`)}</nav>`;
}

export const inquiriesModule: AppModule = {
  name: 'inquiries',
  title: 'Inquiries',
  basePaths: ['/inquiries'],
  // One entry for the whole family. The inbox declares none of its own: the
  // bar on these pages is how you get between them.
  nav: [{ href: '/inquiries', label: 'Incoming', permission: 'register:read', order: 95 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const status = c.req.query('status') ?? '';
      const source = c.req.query('source') ?? '';
      // Filed is a view of its own, not a status: an inquiry can be filed at
      // any stage, and everything else shows only what is still to deal with.
      const view = c.req.query('view') === 'filed' ? 'filed' : 'open';
      const conds: string[] = [view === 'filed' ? 'i.filed_at IS NOT NULL' : 'i.filed_at IS NULL'];
      const params: unknown[] = [];
      if ((INQUIRY_STATUSES as readonly string[]).includes(status)) { conds.push('i.status = ?'); params.push(status); }
      if ((INQUIRY_SOURCES as readonly string[]).includes(source)) { conds.push('i.source = ?'); params.push(source); }
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

      const [rows, counts] = await Promise.all([
        all<InquiryRow & { client_name: string | null }>(
          c.env.DB,
          `SELECT i.*, cl.full_name AS client_name FROM inquiries i
             LEFT JOIN clients cl ON cl.id = i.client_id
             ${whereSql} ORDER BY i.received_at DESC LIMIT 100`,
          ...params,
        ),
        incomingCounts(c.env),
      ]);
      const csrf = c.get('session')!.csrf;
      const deletable = can(c.get('user'), 'register:delete');

      return page(c, { title: 'Inquiries', active: '/inquiries' }, html`
        ${pageHeader('Inquiries', 'New work coming in, from every channel.',
          can(c.get('user'), 'register:write') ? html`<a class="btn btn-primary" href="/inquiries/new">Record an inquiry</a>` : undefined)}
        ${incomingTabs(c.get('user'), 'inquiries', counts)}
        ${raw('<!-- Filed items leave the working list but are never deleted:'
              + ' they are the record that something arrived, and on what day. -->')}
        <nav class="tabs">
          <a class="${view === 'open' ? 'tab current' : 'tab'}" href="/inquiries">To deal with</a>
          <a class="${view === 'filed' ? 'tab current' : 'tab'}" href="/inquiries?view=filed">Filed</a>
        </nav>
        <form method="get" action="/inquiries" class="filters">
          <input type="hidden" name="view" value="${view}">
          <select name="status"><option value="">All statuses</option>
            ${INQUIRY_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${INQUIRY_STATUS_LABELS[s]}</option>`)}
          </select>
          <select name="source"><option value="">All sources</option>
            ${INQUIRY_SOURCES.map((s) => html`<option value="${s}" ${s === source ? raw('selected') : ''}>${INQUIRY_SOURCE_LABELS[s]}</option>`)}
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        ${'' /* Some of what arrives is not work, and the person reading the
                 list is the one who knows which. Deleting from here rather
                 than only from inside each one, because clearing four pieces
                 of noise should not be four page loads. The button is absent
                 on a converted inquiry: the database refuses that, and a
                 button that fails is worse than no button. */}
        ${table(deletable
          ? ['Reference', 'Received', 'From', 'Subject', 'Source', 'Status', '']
          : ['Reference', 'Received', 'From', 'Subject', 'Source', 'Status'], rows.map((row) => html`
          <tr>
            <td><a href="/inquiries/${row.id}"><code>${row.ref}</code></a></td>
            <td class="small">${stamp(row.received_at)}</td>
            <td class="small">${row.client_name
              ? html`<a href="/clients/${row.client_id}">${row.client_name}</a>`
              : html`${row.contact_name ?? row.contact_email ?? row.contact_phone ?? '—'}`}</td>
            <td><a href="/inquiries/${row.id}">${truncate(row.subject ?? row.body, 70) || '(no subject)'}</a></td>
            <td class="small">${INQUIRY_SOURCE_LABELS[row.source] ?? row.source}</td>
            <td>${badge(INQUIRY_STATUS_LABELS[row.status] ?? row.status, statusTone(row.status))}</td>
            ${deletable
              ? html`<td class="row-actions">${row.case_id
                  ? html`<span class="muted small">—</span>`
                  : actionButton(`/inquiries/${row.id}/delete`, csrf, 'Delete', {
                      className: 'btn btn-danger btn-small',
                      confirm: `Delete ${row.ref}? This cannot be undone.`,
                    })}</td>`
              : ''}
          </tr>`))}`);
    });

    r.get('/new', requirePermission('register:write'), async (c) => {
      const csrf = c.get('session')!.csrf;
      const clients = await clientOptions(c.env);
      // A starting point proposed through the address — by the assistant, or by
      // any link. It is a draft in a form somebody submits; the create route
      // below does the validating, as it does for anything typed by hand.
      const pre = (name: string, max = 320) => (c.req.query(name) ?? '').slice(0, max);
      const prefilled = Boolean(pre('contact_name') || pre('contact_email') || pre('subject'));

      return page(c, { title: 'Record an inquiry', active: '/inquiries' }, html`
        ${breadcrumbs([{ href: '/inquiries', label: 'Inquiries' }, { label: 'New' }])}
        ${pageHeader('Record an inquiry')}
        ${prefilled
          ? html`<div class="alert alert-ok">Filled in from what the assistant read. Check it before
                   saving — it is a reading, not a fact.</div>`
          : ''}
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
            ${field({ label: 'Name', name: 'contact_name', maxlength: 200, value: pre('contact_name', 200) })}
            ${field({ label: 'Email', name: 'contact_email', type: 'email', maxlength: 320, value: pre('contact_email') })}
            ${field({ label: 'Phone', name: 'contact_phone', maxlength: 60, value: pre('contact_phone', 60) })}
          </div>
          <div class="form-section">
            <h3>What they asked</h3>
            ${field({ label: 'Subject', name: 'subject', maxlength: 200, value: pre('subject', 200) })}
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
      // A first guess at where the family name ends, shown in the form so a
      // person can correct it before it is saved rather than after.
      const guessedName = splitFullName(inq.contact_name ?? '');
      const fileTargets = writable && !inq.filed_at ? await filingOptions(c.env) : [];
      const filedTarget: 'case' | 'client' | null = inq.filed_at
        ? (inq.case_id ? 'case' : inq.client_id ? 'client' : null) : null;
      const filedOn = filedTarget
        ? await filingTargetLabel(c.env, filedTarget, (filedTarget === 'case' ? inq.case_id : inq.client_id)!)
        : null;

      return page(c, { title: inq.ref, active: '/inquiries' }, html`
        ${breadcrumbs([{ href: '/inquiries', label: 'Inquiries' }, { label: inq.ref }])}
        ${pageHeader(inq.subject || `Inquiry ${inq.ref}`,
          `${inq.ref} · ${INQUIRY_SOURCE_LABELS[inq.source]} · received ${stamp(inq.received_at)}`,
          writable
            ? html`<a class="btn btn-secondary" href="/inquiries/${inq.id}/edit">Edit</a>
                   ${inq.client_id
                     ? html`<a class="btn btn-secondary" href="/quotes/new?client_id=${inq.client_id}&inquiry_id=${inq.id}">Quote this</a>`
                     : ''}
                   ${'' /* Offered here as well as in the list, because this is
                            where you are when you have just read it and decided
                            it is nothing. Absent once it has become a matter —
                            the database refuses that, and there is no sense in
                            a button whose only outcome is an error. */}
                   ${can(c.get('user'), 'register:delete') && !inq.case_id
                     ? actionButton(`/inquiries/${inq.id}/delete`, csrf, 'Delete', {
                         className: 'btn btn-danger',
                         confirm: `Delete ${inq.ref}? This cannot be undone.` })
                     : ''}`
            : undefined)}

        ${inq.filed_at
          ? html`<div class="alert alert-ok">
                   Filed on ${filedOn && filedTarget
                     ? html`<a href="/${filedTarget === 'case' ? 'cases' : 'clients'}/${filedTarget === 'case' ? inq.case_id : inq.client_id}">${filedOn}</a>`
                     : 'a record that has since gone'}
                   — ${dateShort(inq.filed_at)}. The inquiry itself is kept, unchanged.
                   ${writable ? html`
                     <form method="post" action="/inquiries/${inq.id}/unfile" class="inline-form">
                       ${csrfField(csrf)}
                       <button class="btn btn-small btn-secondary" type="submit">Put it back in the list</button>
                     </form>` : ''}
                 </div>`
          : writable && fileTargets.length > 0
            ? card('File it on a matter or client', html`
                <form method="post" action="/inquiries/${inq.id}/file" class="row-form">
                  ${csrfField(csrf)}
                  ${select({ label: 'File on', name: 'onto', required: true,
                             includeBlank: 'Choose a matter or client', options: fileTargets })}
                  <button class="btn btn-primary" type="submit">File it</button>
                </form>
                <p class="hint">A note is written on that record with this inquiry's date, contact and
                   text, and the inquiry moves to the Filed tab. Nothing is deleted, and you can put
                   it back.</p>`)
            : ''}

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

                  ${'' /* Everything from here to the matter title describes the
                           client this inquiry would create, and each box is the
                           box the client form uses, read by the same code and
                           stored through the same helpers. One field called
                           "name" produced clients written unlike every other
                           client, and 'individual' assumed for everybody made a
                           company into a person named after itself. A guess at
                           where the family name ends is shown so it can be
                           corrected before it is saved rather than after. */}
                  <fieldset class="field-group js-kind">
                    <legend>New client</legend>
                    ${select({ label: 'Record type', name: 'kind', value: 'individual', includeBlank: false,
                               options: [{ value: 'individual', label: 'Individual' },
                                         { value: 'organisation', label: 'Company or organisation' }],
                               hint: 'Only used when no existing client is chosen above.' })}
                    ${'' /* Hidden by the server as well as by the script, so
                             the wrong half is never on the page whether or not
                             scripting runs. */}
                    <div data-kind="individual">
                      ${field({ label: 'Given names', name: 'given_names', maxlength: 120,
                                value: guessedName.givenNames,
                                hint: 'As they appear in the passport.' })}
                      ${field({ label: 'Family name', name: 'family_name', maxlength: 120,
                                value: guessedName.familyName,
                                hint: 'Stored in capitals, as a passport writes it.' })}
                      ${select({ label: 'Nationality', name: 'nationality', value: '',
                                 options: countryOptions(), includeBlank: 'Not recorded' })}
                    </div>
                    <div data-kind="organisation" ${raw('hidden')}>
                      ${field({ label: 'Registered name', name: 'organisation_name', maxlength: 200,
                                value: inq.contact_name ?? '',
                                hint: 'Exactly as registered — the NZBN register is the authority.' })}
                    </div>
                  </fieldset>
                  ${field({ label: 'Matter title', name: 'title', required: true, maxlength: 200,
                            value: inq.subject ?? '', placeholder: 'e.g. Partnership work visa' })}
                  ${select({ label: 'Case type', name: 'case_type', value: '', required: true,
                             options: termOptions(types), includeBlank: 'Choose a type' })}
                  ${'' /* No "Unassigned": a matter always belongs to somebody,
                           and the database refuses one that does not. This form
                           would otherwise offer a choice that fails on submit. */}
                  ${select({ label: 'Assign to', name: 'assigned_to', required: true,
                             includeBlank: false,
                             value: inq.assigned_to ?? c.get('user')!.id, options: users })}
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
                  ${timelineItem({
                    entry: e,
                    kindLabel: ENTRY_KIND_LABELS[e.kind] ?? e.kind,
                    happened: stamp(e.occurred_at),
                    written: stamp(e.created_at),
                    correction: writable && correctable(e, c.get('user')?.id ?? null)
                      ? { csrf, minutes: CORRECTION_WINDOW_MINUTES,
                          kindOptions: optionsFrom(
                            ENTRY_KINDS.filter((k) => k !== 'system') as any,
                            ENTRY_KIND_LABELS as any) }
                      : null,
                  })}`)}</ul>`}`)}
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

    /**
     * File an inquiry onto the matter or client it belongs to.
     *
     * Same shape as the inbox: a note is written on the record, the inquiry is
     * marked filed, and it leaves the working list for the Filed tab. The
     * inquiry itself is not touched — it is the record that somebody made
     * contact, and on what day.
     */
    r.post('/:id/file', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const inq = await one<InquiryRow>(c.env.DB, 'SELECT * FROM inquiries WHERE id = ?', id);
      if (!inq) return c.notFound();
      // See the inbox route: filing twice leaves a note nobody can remove.
      if (inq.filed_at) return redirectWith(c, `/inquiries/${id}`, 'That inquiry is already filed.', 'err');

      const f = new FormReader(await c.req.formData());
      const choice = parseFilingChoice(f.optional('onto', { max: 100 }));
      if (!choice) return redirectWith(c, `/inquiries/${id}`, 'Choose a matter or a client to file it on.', 'err');

      const user = c.get('user')!;
      const filed = await fileOntoRecord(c.env, {
        target: choice.target, targetId: choice.targetId, userId: user.id,
        origin: `inquiry ${inq.ref}`,
        source: {
          channel: inq.source, receivedAt: inq.received_at,
          from: inq.contact_name ?? inq.contact_email ?? inq.contact_phone,
          subject: inq.subject, body: inq.body,
        },
      }, markLinkedFiled(c.env, 'inquiries', id, choice.target, choice.targetId, user.id));
      if (!filed) return redirectWith(c, `/inquiries/${id}`, 'That matter or client no longer exists.', 'err');
      await auditFrom(c, { action: 'inquiry.filed', entityType: 'inquiry', entityId: id,
        meta: { target: choice.target, targetId: choice.targetId, entryId: filed.entryId } });
      return redirectWith(c, `/${choice.target === 'case' ? 'cases' : 'clients'}/${choice.targetId}`,
        `Filed on ${filed.label}.`);
    });

    /** Back to the working list. The note it wrote stays on the file. */
    r.post('/:id/unfile', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const cleared = await unfile(c.env, 'inquiries', id);
      await auditFrom(c, { action: 'inquiry.unfiled', entityType: 'inquiry', entityId: id, meta: { orphanedEntryId: cleared.orphanedEntryId }  });
      return redirectWith(c, `/inquiries/${id}`,
        'Back in the list. The note written when it was filed stays on the file.');
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

    r.post('/:id/delete', requirePermission('register:delete'), async (c) => {
      const id = c.req.param('id')!;
      const inq = await one<InquiryRow>(c.env.DB, 'SELECT * FROM inquiries WHERE id = ?', id);
      if (!inq) return c.notFound();

      // The delete is attempted first, and audited only if it happens. The row
      // holds nothing the audit needs — `inq` was read above and keeps every
      // value — so there is no reason to record the deletion before it is real.
      // Auditing first wrote `inquiry.deleted` for inquiries the database then
      // refused (one carrying a quote, a task, a document or a file note but no
      // case), leaving the log asserting a deletion that never happened.
      try {
        await run(c.env.DB, 'DELETE FROM inquiries WHERE id = ?', id);
      } catch (err) {
        return redirectWith(c, `/inquiries/${id}`,
          refusal(err) ?? 'That inquiry could not be deleted.', 'err');
      }
      await auditFrom(c, { action: 'inquiry.deleted', entityType: 'inquiry', entityId: id,
        meta: { ref: inq.ref, source: inq.source, subject: inq.subject,
                contact: inq.contact_name ?? inq.contact_email ?? inq.contact_phone } });
      return redirectWith(c, '/inquiries', `Inquiry ${inq.ref} deleted.`);
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
      const kind = f.enum('kind', ['individual', 'organisation'] as const, { fallback: 'individual' })!;
      const givenNames = f.optional('given_names', { max: 120 });
      const familyName = f.optional('family_name', { max: 120 });
      const organisationName = f.optional('organisation_name', { max: 200 });
      // A dropdown on the form, so this is already a code. Resolved anyway: a
      // request built by hand carrying "Vietnam" then lands as VN rather than
      // as a 500 from the trigger guarding the column.
      const nationality = countryCodeFor(f.optional('nationality', { max: 100 }));
      const title = f.text('title', { required: true, label: 'Matter title', max: 200 });
      const types = await caseTypes(c.env);
      const caseType = f.text('case_type', { required: true, label: 'Case type', max: 60 });
      if (caseType && !isTerm(types, caseType)) {
        return redirectWith(c, `/inquiries/${id}`, 'That is not one of the case types you have configured.', 'err');
      }
      const assignedTo = f.text('assigned_to', { required: true, label: 'Assign to', max: 60 });
      if (!f.valid || !caseType) return redirectWith(c, `/inquiries/${id}`, Object.values(f.errors)[0] ?? 'Invalid conversion.', 'err');
      if (!(await isAssignable(c.env, assignedTo))) {
        return redirectWith(c, `/inquiries/${id}`,
          'That person cannot be given work. Choose an active user.', 'err');
      }

      let targetClientId = clientId || inq.client_id;
      if (!targetClientId) {
        // Written through the same helpers the client form uses, so a client
        // created here is stored exactly as one created there: family name in
        // capitals, in plain English letters, however it arrived.
        const split = givenNames || familyName
          ? { givenNames: givenNames ?? '', familyName: familyName ?? '' }
          : splitFullName(inq.contact_name ?? inq.contact_email ?? 'Unnamed client');
        const given = kind === 'individual' ? plainAscii(split.givenNames) : '';
        const family = kind === 'individual' ? familyNameFor(split.familyName) : '';
        // An organisation is named by its registered name and nothing else. If
        // the box was left empty the inquiry's own contact name stands in,
        // because a nameless client helps nobody.
        const registered = kind === 'organisation'
          ? (organisationName || inq.contact_name || inq.contact_email || 'Unnamed organisation')
          : '';
        targetClientId = newId('cli');
        const clientRef = await nextRef(c.env.DB, 'client', 'CL');
        await run(
          c.env.DB,
          `INSERT INTO clients (id, ref, kind, full_name, given_names, family_name,
              email, phone, status, assigned_to, created_at, updated_at, created_by)
           VALUES (?,?,?,?,?,?,?,?,'prospect',?,?,?,?)`,
          targetClientId, clientRef, kind,
          composeFullName(kind, { givenNames: given, familyName: family }, registered),
          given || null, family || null,
          inq.contact_email, inq.contact_phone,
          assignedTo, nowIso(), nowIso(), user.id,
        );
        if (kind === 'individual' && nationality) {
          await c.env.DB.batch(setNationalityStatements(c.env, targetClientId, [nationality]));
        }
        await addEntry(c.env, { entityType: 'client', entityId: targetClientId, kind: 'system',
          body: `Client created from inquiry ${inq.ref}.`, createdBy: user.id });
      }

      const caseId = newId('cas');
      const caseRef = await nextYearlyRef(c.env.DB, 'case', 'CASE');
      await run(
        c.env.DB,
        `INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, assigned_to,
            summary, currency, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,'lead','normal',?,?, 'NZD', ?,?,?)`,
        caseId, caseRef, targetClientId, title, caseType, assignedTo,
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
