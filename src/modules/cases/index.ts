/**
 * Module: cases.
 *
 * A case is one matter for one client: an application, an appeal, a s.61
 * request. It carries the status lifecycle, the INZ references, the fees and
 * the tasks that have to happen before the next deadline.
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
import { html, raw, type Raw } from '../../ui/html';
import {
  badge, card, csrfField, emptyState, errorList, field, optionsFrom,
  pageHeader, select, statusTone, table,
} from '../../ui/components';
import { dateInputValue, dateShort, dateTime, isOverdue, relativeDays, truncate, dateOrDateTime, instantForDate } from '../../ui/format';
import {
  canTransition, CASE_STATUS_HELP, CASE_STATUS_LABELS, CASE_STATUSES, CASE_TRANSITIONS,
  DEADLINE_CASE_STATUSES, ENTRY_KIND_LABELS, ENTRY_KINDS,
  isOpenStatus, isPartyRole, OPEN_CASE_STATUSES, PARTY_ROLE_LABELS, PARTY_ROLES, PRIORITIES,
  PRIORITY_LABELS, TASK_STATUS_LABELS, type CaseStatus,
} from '../../domain';
import { clientOptions, userOptions } from '../../core/lookups';
import { addParty, partiesForCase, removeParty } from '../../core/parties';
import { findOrCreateTag, listTags, tagCase, tagsForCase, tagsForCases, untagCase } from '../../core/tags';
import { addEntry, listEntries } from '../../core/timeline';
import { can } from '../../core/rbac';
import { asPrefInteger, preferencesFor } from '../../core/preferences';
import { storeDocument } from '../documents';
import {
  DECISION_SETTINGS, caseForSync, decisionPolicy, expectedDecisionDate, syncCaseFollowUps,
} from '../../core/decisions';
import { isAiEnabled } from '../../ai/provider';
import { briefCase, latestBrief } from '../../ai/brief';
import {
  VOCABULARY_SETTINGS, caseTypes, isTerm, labelFor, termOptions, type Term,
} from '../../core/vocabulary';
import { feesSection } from '../fees';

export interface CaseRow {
  id: string; ref: string; client_id: string; title: string; case_type: string;
  status: CaseStatus; priority: string; assigned_to: string | null;
  inz_application_number: string | null; inz_client_number: string | null;
  lodged_at: string | null; decision_due_at: string | null; decided_at: string | null;
  chase_inz: number;
  outcome: string | null; fee_quoted_cents: number | null; fee_agreed_cents: number | null;
  currency: string; next_action: string | null; next_action_due: string | null;
  summary: string | null; created_at: string; updated_at: string;
  created_by: string | null; closed_at: string | null;
}

const DEFAULT_PAGE_SIZE = 25;

function caseForm(
  c: any,
  values: Partial<CaseRow>,
  clients: Array<{ value: string; label: string }>,
  users: Array<{ value: string; label: string }>,
  types: Term[],
  errors?: Record<string, string>,
): Raw {
  const csrf = c.get('session').csrf;
  const action = values.id ? `/cases/${values.id}` : '/cases';
  return html`
    ${errorList(errors)}
    <form method="post" action="${action}" class="form-grid">
      ${csrfField(csrf)}
      <div class="form-section">
        <h3>Matter</h3>
        ${select({ label: 'Client', name: 'client_id', value: values.client_id ?? '', required: true,
                   options: clients, includeBlank: 'Choose a client' })}
        ${field({ label: 'Matter title', name: 'title', value: values.title, required: true, maxlength: 200,
                  placeholder: 'e.g. AEWV — Chef, Auckland' })}
        ${select({ label: 'Case type', name: 'case_type', value: values.case_type ?? '', required: true,
                   options: termOptions(types), includeBlank: 'Choose a type' })}
        ${values.id
          ? html`<div class="field"><label>Status</label>
                 <p class="hint">Status changes are made from the case page so the reason is recorded.</p></div>`
          : select({ label: 'Opening status', name: 'status', value: 'lead', includeBlank: false,
                     options: optionsFrom(['lead', 'engaged'] as const, CASE_STATUS_LABELS as any) })}
        ${select({ label: 'Priority', name: 'priority', value: values.priority ?? 'normal', includeBlank: false,
                   options: optionsFrom(PRIORITIES, PRIORITY_LABELS) })}
        ${select({ label: 'Assigned to', name: 'assigned_to', value: values.assigned_to ?? '', options: users, includeBlank: 'Unassigned' })}
      </div>

      <div class="form-section">
        <h3>Immigration New Zealand</h3>
        ${field({ label: 'INZ application number', name: 'inz_application_number', value: values.inz_application_number, maxlength: 60 })}
        ${field({ label: 'INZ client number', name: 'inz_client_number', value: values.inz_client_number, maxlength: 60 })}
        ${field({ label: 'Lodged on', name: 'lodged_at', type: 'date', value: dateInputValue(values.lodged_at) })}
        ${field({ label: 'Response / decision due', name: 'decision_due_at', type: 'date', value: dateInputValue(values.decision_due_at),
                  hint: 'The date that must not be missed — RFI or PPI deadline, or expected decision. '
                    + 'Left empty on a lodged matter, it is filled in from the practice default.' })}
        <div class="field checkbox-field">
          <label><input type="checkbox" name="chase_inz" value="1"
                   ${values.chase_inz === 0 ? '' : raw('checked')}>
            Chase INZ when this decision is overdue</label>
          <p class="hint">On by default. Turn it off for a matter that should not be chased —
             one under a formal complaint, or where the client has asked for silence.</p>
        </div>
      </div>

      <div class="form-section">
        <h3>Working notes</h3>
        ${field({ label: 'Next action', name: 'next_action', value: values.next_action, maxlength: 200 })}
        ${field({ label: 'Next action due', name: 'next_action_due', type: 'date', value: dateInputValue(values.next_action_due) })}
        ${field({ label: 'Summary', name: 'summary', type: 'textarea', rows: 4, value: values.summary, maxlength: 4000,
                  hint: 'The one-paragraph picture of this matter for whoever picks it up next.' })}
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" type="submit">${values.id ? 'Save changes' : 'Create case'}</button>
        <a class="btn btn-secondary" href="${values.id ? `/cases/${values.id}` : '/cases'}">Cancel</a>
      </div>
    </form>`;
}

function readCaseForm(f: FormReader, types: Term[]) {
  // Validated against the configured vocabulary rather than a compile-time
  // list: the practice owns the list, but only what is on it can be stored.
  const submittedType = f.text('case_type', { required: true, label: 'Case type', max: 60 });
  if (submittedType && !isTerm(types, submittedType)) {
    f.errors['case_type'] = 'That is not one of the case types you have configured.';
  }
  return {
    client_id: f.text('client_id', { required: true, label: 'Client', max: 60 }),
    title: f.text('title', { required: true, label: 'Matter title', max: 200 }),
    case_type: submittedType,
    priority: f.enum('priority', PRIORITIES, { fallback: 'normal' })!,
    assigned_to: f.optional('assigned_to', { max: 60 }),
    inz_application_number: f.optional('inz_application_number', { max: 60 }),
    inz_client_number: f.optional('inz_client_number', { max: 60 }),
    lodged_at: f.date('lodged_at'),
    decision_due_at: f.date('decision_due_at'),
    chase_inz: f.checkbox('chase_inz') ? 1 : 0,
    next_action: f.optional('next_action', { max: 200 }),
    next_action_due: f.date('next_action_due'),
    summary: f.optional('summary', { max: 4000 }),
  };
}

export const casesModule: AppModule = {
  name: 'cases',
  title: 'Cases',
  basePaths: ['/cases'],
  settings: [VOCABULARY_SETTINGS, DECISION_SETTINGS],
  nav: [{ href: '/cases', label: 'Cases', permission: 'register:read', order: 80 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    // --- List ---------------------------------------------------------------
    r.get('/', requirePermission('register:read'), async (c) => {
      const types = await caseTypes(c.env);
      const prefs = await preferencesFor(c.env, c.get('user')!.id);
      const PAGE_SIZE = asPrefInteger(prefs['pref.page_size'], DEFAULT_PAGE_SIZE);
      const q = (c.req.query('q') ?? '').trim();
      const status = c.req.query('status') ?? '';
      const assigned = c.req.query('assigned') ?? '';
      // A view the person asked for wins; otherwise where they said they like to start.
      const scope = c.req.query('scope') ?? prefs['pref.cases_scope'] ?? 'open';
      const pageNum = Math.max(1, Number(c.req.query('page') ?? '1') || 1);

      const where: string[] = [];
      const params: unknown[] = [];
      const p = () => `?${params.length}`;

      if (q) {
        params.push(`%${q}%`);
        const ph = p();
        where.push(`(k.title LIKE ${ph} OR k.ref LIKE ${ph} OR cl.full_name LIKE ${ph} OR k.inz_application_number LIKE ${ph})`);
      }
      if (status && (CASE_STATUSES as readonly string[]).includes(status)) {
        params.push(status);
        where.push(`k.status = ${p()}`);
      } else if (scope === 'open') {
        where.push(`k.status IN (${OPEN_CASE_STATUSES.map(() => '?').join(',')})`);
        params.push(...OPEN_CASE_STATUSES);
      }
      if (assigned === 'me') {
        params.push(c.get('user')!.id);
        where.push(`k.assigned_to = ${p()}`);
      }
      const tagFilter = c.req.query('tag') ?? '';
      if (tagFilter) {
        params.push(tagFilter);
        where.push(`EXISTS (SELECT 1 FROM case_tags ct JOIN tags t ON t.id = ct.tag_id
                             WHERE ct.case_id = k.id AND t.name = ${p()})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      params.push(PAGE_SIZE + 1, (pageNum - 1) * PAGE_SIZE);

      const rows = await all<CaseRow & { client_name: string; client_ref: string; assignee_name: string | null }>(
        c.env.DB,
        `SELECT k.*, cl.full_name AS client_name, cl.ref AS client_ref, u.name AS assignee_name
           FROM cases k
           JOIN clients cl ON cl.id = k.client_id
           LEFT JOIN users u ON u.id = k.assigned_to
           ${whereSql}
          ORDER BY CASE k.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                   COALESCE(k.decision_due_at, k.next_action_due, '9999') ASC,
                   k.updated_at DESC
          LIMIT ?${params.length - 1} OFFSET ?${params.length}`,
        ...params,
      );
      const hasMore = rows.length > PAGE_SIZE;
      const shown = rows.slice(0, PAGE_SIZE);
      const [tagsByCase, allTags] = await Promise.all([
        tagsForCases(c.env, shown.map((row) => row.id)),
        listTags(c.env),
      ]);

      const qs = (over: Record<string, string | number>) =>
        new URLSearchParams({ q, status, assigned, scope, tag: tagFilter, page: String(pageNum), ...Object.fromEntries(Object.entries(over).map(([k2, v]) => [k2, String(v)])) }).toString();

      return page(c, { title: 'Cases', active: '/cases' }, html`
        ${pageHeader('Cases', 'Every matter the practice is running.',
          can(c.get('user'), 'register:write') ? html`<a class="btn btn-primary" href="/cases/new">New case</a>` : undefined)}
        <form method="get" action="/cases" class="filters" data-live-search>
          <input type="search" name="q" value="${q}" placeholder="Search matter, client, reference or INZ number">
          <select name="status">
            <option value="">${scope === 'all' ? 'All statuses' : 'Open statuses'}</option>
            ${CASE_STATUSES.map((s) => html`<option value="${s}" ${s === status ? raw('selected') : ''}>${CASE_STATUS_LABELS[s]}</option>`)}
          </select>
          <select name="scope">
            <option value="open" ${scope === 'open' ? raw('selected') : ''}>Open only</option>
            <option value="all" ${scope === 'all' ? raw('selected') : ''}>Everything</option>
          </select>
          <select name="assigned">
            <option value="">Anyone</option>
            <option value="me" ${assigned === 'me' ? raw('selected') : ''}>Assigned to me</option>
          </select>
          <select name="tag">
            <option value="">Any tag</option>
            ${allTags.map((tag) => html`<option value="${tag.name}" ${tag.name === tagFilter ? raw('selected') : ''}>${tag.name} (${tag.uses})</option>`)}
          </select>
          <button class="btn btn-secondary" type="submit">Filter</button>
        </form>
        <div data-live-results>
        ${/*
          * Six columns will not fit a phone. Rather than shrinking them all
          * until every cell wraps one word per line, four of them are dropped
          * and their content folded into the matter cell, where it reads as a
          * sentence instead of a squeezed column. The same rows serve both
          * layouts, so there is one list to maintain, not two.
          */ ''}
        ${table([
          { label: 'Reference', width: '16', hideOn: 'sm' },
          { label: 'Matter', width: '30' },
          { label: 'Client', width: '18', hideOn: 'sm' },
          { label: 'Status', width: '18', hideOn: 'sm' },
          { label: 'Key date', width: '18' },
          { label: 'Owner', width: '12', hideOn: 'sm' },
        ], shown.map((row) => {
          const overdue = isOverdue(row.decision_due_at) && isOpenStatus(row.status);
          return html`
          <tr class="${row.priority === 'urgent' ? 'row-urgent' : ''}">
            <td class="col-sm-hide"><a href="/cases/${row.id}"><code>${row.ref}</code></a>
                ${row.priority !== 'normal' ? badge(PRIORITY_LABELS[row.priority as keyof typeof PRIORITY_LABELS], row.priority === 'urgent' ? 'red' : 'amber') : ''}</td>
            <td>
              <a class="clamp-2" href="/cases/${row.id}">${row.title}</a>
              <div class="muted small clamp-1">${labelFor(types, row.case_type)}</div>
              <div class="row-meta show-sm">
                <code>${row.ref}</code>
                <a href="/clients/${row.client_id}">${row.client_name}</a>
                ${badge(CASE_STATUS_LABELS[row.status] ?? row.status, statusTone(row.status))}
                ${row.priority !== 'normal'
                  ? badge(PRIORITY_LABELS[row.priority as keyof typeof PRIORITY_LABELS], row.priority === 'urgent' ? 'red' : 'amber')
                  : ''}
              </div>
              ${(tagsByCase.get(row.id) ?? []).length > 0
                ? html`<div class="tag-row hide-sm">${(tagsByCase.get(row.id) ?? []).map((tag) => badge(tag.name, tag.colour))}</div>`
                : ''}
            </td>
            <td class="small col-sm-hide"><a href="/clients/${row.client_id}">${row.client_name}</a></td>
            <td class="col-sm-hide">${badge(CASE_STATUS_LABELS[row.status] ?? row.status, statusTone(row.status))}</td>
            <td class="small ${overdue ? 'warn' : ''}">
              ${row.decision_due_at
                ? html`${dateShort(row.decision_due_at)}<div class="muted">${relativeDays(row.decision_due_at)}</div>`
                : row.next_action_due
                  ? html`${dateShort(row.next_action_due)}<div class="muted">next action</div>`
                  : '—'}</td>
            <td class="small col-sm-hide">${row.assignee_name ?? '—'}</td>
          </tr>`;
        }), { sticky: true, fixed: true, empty: 'No cases match that.' })}
        <div class="pager">
          ${pageNum > 1 ? html`<a class="btn btn-secondary" href="/cases?${raw(qs({ page: pageNum - 1 }))}">Previous</a>` : ''}
          ${hasMore ? html`<a class="btn btn-secondary" href="/cases?${raw(qs({ page: pageNum + 1 }))}">Next</a>` : ''}
        </div>
        </div>`);
    });

    // --- Create -------------------------------------------------------------
    r.get('/new', requirePermission('register:write'), async (c) => {
      const [clients, users, types] = await Promise.all([
        clientOptions(c.env), userOptions(c.env), caseTypes(c.env),
      ]);
      const preset = c.req.query('client_id') ?? '';
      return page(c, { title: 'New case', active: '/cases' }, html`
        ${breadcrumbs([{ href: '/cases', label: 'Cases' }, { label: 'New' }])}
        ${pageHeader('New case', null, can(c.get('user'), 'ai:run')
          ? html`<a class="btn btn-secondary" href="/assistant/intake">Open one from a document</a>`
          : undefined)}
        ${clients.length === 0
          ? emptyState('Create a client first — a case always belongs to one.',
              html`<a class="btn btn-primary" href="/clients/new">New client</a>`)
          : caseForm(c, { client_id: preset }, clients, users, types)}`);
    });

    r.post('/', requirePermission('register:write'), async (c) => {
      const types = await caseTypes(c.env);
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const v = readCaseForm(f, types);
      const status = f.enum('status', ['lead', 'engaged'] as const, { fallback: 'lead' })!;

      const client = v.client_id
        ? await one<{ id: string; ref: string }>(c.env.DB, 'SELECT id, ref FROM clients WHERE id = ?', v.client_id)
        : null;
      if (!client) f.errors['client_id'] = 'Choose an existing client.';

      if (!f.valid) {
        const [clients, users] = await Promise.all([clientOptions(c.env), userOptions(c.env)]);
        return page(c, { title: 'New case', active: '/cases', status: 400 }, html`
          ${pageHeader('New case')}${caseForm(c, v as Partial<CaseRow>, clients, users, types, f.errors)}`);
      }

      const id = newId('cas');
      const ref = await nextRef(c.env.DB, 'case', 'CASE');
      const policy = await decisionPolicy(c.env);
      // A lodged matter with no expected decision gets the practice's default,
      // because a date nobody typed is still a date the alerts page can watch.
      const decisionDue = v.decision_due_at
        ?? expectedDecisionDate(v.lodged_at, policy.expectedMonths);
      await run(
        c.env.DB,
        `INSERT INTO cases (id, ref, client_id, title, case_type, status, priority, assigned_to,
            inz_application_number, inz_client_number, lodged_at, decision_due_at,
            next_action, next_action_due, summary, chase_inz, currency, created_at, updated_at, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'NZD',?,?,?)`,
        id, ref, v.client_id, v.title, v.case_type, status, v.priority, v.assigned_to || null,
        v.inz_application_number, v.inz_client_number, v.lodged_at, decisionDue,
        v.next_action, v.next_action_due, v.summary, v.chase_inz, nowIso(), nowIso(), user.id,
      );
      await run(
        c.env.DB,
        'INSERT INTO case_status_history (id, case_id, from_status, to_status, at, by_user_id, note) VALUES (?,?,?,?,?,?,?)',
        newId('csh'), id, null, status, nowIso(), user.id, 'Case opened',
      );
      await addEntry(c.env, { entityType: 'case', entityId: id, kind: 'system', body: `Case ${ref} opened.`, createdBy: user.id });
      await auditFrom(c, { action: 'case.created', entityType: 'case', entityId: id, meta: { ref, client: client!.ref } });
      return redirectWith(c, `/cases/${id}`, `Case ${ref} created.`);
    });

    // --- Detail -------------------------------------------------------------
    r.get('/:id', requirePermission('register:read'), async (c) => {
      const types = await caseTypes(c.env);
      const id = c.req.param('id')!;
      const viewer = c.get('user')!;
      const docsEnabled = Boolean(c.env.DOCS);
      const aiAvailable = isAiEnabled(c.env) && can(viewer, 'ai:run');
      const brief = aiAvailable ? await latestBrief(c.env, id) : null;
      const kase = await one<CaseRow & { client_name: string; client_ref: string; assignee_name: string | null }>(
        c.env.DB,
        `SELECT k.*, cl.full_name AS client_name, cl.ref AS client_ref, u.name AS assignee_name
           FROM cases k JOIN clients cl ON cl.id = k.client_id
           LEFT JOIN users u ON u.id = k.assigned_to
          WHERE k.id = ?`,
        id,
      );
      if (!kase) return c.notFound();

      const writable = can(c.get('user'), 'register:write');
      const csrf = c.get('session')!.csrf;

      const [entries, history, tasks, quotes, users, fees, parties, caseTags, allTags, clients] = await Promise.all([
        listEntries(c.env, 'case', id),
        all<any>(c.env.DB, `SELECT h.*, u.name AS by_name FROM case_status_history h
                              LEFT JOIN users u ON u.id = h.by_user_id
                             WHERE h.case_id = ? ORDER BY h.at DESC LIMIT 30`, id),
        all<any>(c.env.DB, `SELECT t.*, u.name AS assignee_name FROM tasks t
                              LEFT JOIN users u ON u.id = t.assigned_to
                             WHERE t.entity_type = 'case' AND t.entity_id = ?
                             ORDER BY CASE t.status WHEN 'done' THEN 1 WHEN 'cancelled' THEN 1 ELSE 0 END,
                                      COALESCE(t.due_at, '9999')`, id),
        all<any>(c.env.DB, `SELECT id, ref, description, amount_cents, gst_cents, disbursements_cents, currency, status
                              FROM quotes WHERE case_id = ? ORDER BY created_at DESC`, id),
        userOptions(c.env),
        feesSection(c, id, kase.currency, writable),
        partiesForCase(c.env, id),
        tagsForCase(c.env, id),
        listTags(c.env),
        clientOptions(c.env),
      ]);

      const nextStatuses = CASE_TRANSITIONS[kase.status] ?? [];
      const deadlineWarning = DEADLINE_CASE_STATUSES.includes(kase.status) && kase.decision_due_at;

      return page(c, { title: `${kase.ref} — ${kase.title}`, active: '/cases' }, html`
        ${breadcrumbs([{ href: '/cases', label: 'Cases' },
                       { href: `/clients/${kase.client_id}`, label: kase.client_name },
                       { label: kase.ref }])}
        ${pageHeader(kase.title,
          `${kase.ref} · ${labelFor(types, kase.case_type)} · ${kase.client_name}`,
          writable ? html`<a class="btn btn-secondary" href="/cases/${kase.id}/edit">Edit</a>
                          <a class="btn btn-secondary" href="/quotes/new?case_id=${kase.id}&client_id=${kase.client_id}">New quote</a>` : undefined)}

        ${deadlineWarning
          ? html`<div class="alert ${isOverdue(kase.decision_due_at) ? 'alert-error' : 'alert-warn'}">
                   <strong>${CASE_STATUS_LABELS[kase.status]}</strong> — response due
                   ${dateShort(kase.decision_due_at)} (${relativeDays(kase.decision_due_at)}).
                 </div>`
          : ''}

        <div class="cols">
          <div class="col-main">
            ${card('Status', html`
              <p class="status-now">${badge(CASE_STATUS_LABELS[kase.status], statusTone(kase.status))}
                 <span class="muted">${CASE_STATUS_HELP[kase.status]}</span></p>
              ${writable && nextStatuses.length > 0 ? html`
                <form method="post" action="/cases/${kase.id}/status" class="row-form">
                  ${csrfField(csrf)}
                  ${select({ label: 'Move to', name: 'status', value: '', required: true, includeBlank: 'Choose a status',
                             options: nextStatuses.map((s) => ({ value: s, label: CASE_STATUS_LABELS[s] })) })}
                  ${field({ label: 'Note (recorded on the file)', name: 'note', maxlength: 500,
                            placeholder: 'e.g. Lodged online, receipt 12345' })}
                  ${field({ label: 'Response / decision due', name: 'decision_due_at', type: 'date',
                            value: dateInputValue(kase.decision_due_at),
                            hint: 'Set this when moving to an RFI, PPI or appeal status.' })}
                  <button class="btn btn-primary" type="submit">Update status</button>
                </form>` : ''}
              ${history.length > 0 ? html`
                <details><summary>Status history</summary>
                  <ul class="list small">
                    ${history.map((h: any) => html`<li>
                      ${dateTime(h.at)} — ${h.from_status ? `${CASE_STATUS_LABELS[h.from_status as CaseStatus] ?? h.from_status} → ` : ''}
                      <strong>${CASE_STATUS_LABELS[h.to_status as CaseStatus] ?? h.to_status}</strong>
                      ${h.by_name ? ` · ${h.by_name}` : ''}${h.note ? ` · ${h.note}` : ''}</li>`)}
                  </ul>
                </details>` : ''}`)}

            ${card('Parties', html`
              ${parties.length === 0 ? emptyState('No parties recorded.') : html`
                <ul class="party-list">
                  ${parties.map((party) => html`
                    <li>
                      <div>
                        <a href="/clients/${party.client_id}">${party.client_name}</a>
                        ${badge(PARTY_ROLE_LABELS[party.role] ?? party.role,
                                party.role === 'principal_applicant' ? 'blue'
                                : party.role === 'employer' ? 'amber' : 'neutral')}
                        <div class="muted small">
                          <code>${party.client_ref}</code>
                          ${party.client_kind === 'organisation' ? ' · organisation' : ''}
                          ${party.notes ? ` · ${party.notes}` : ''}
                        </div>
                      </div>
                      ${writable && party.client_id !== kase.client_id ? html`
                        <form method="post" action="/cases/${kase.id}/parties/${party.id}/remove"
                              class="inline-form" data-confirm="Remove this party from the case?">
                          ${csrfField(csrf)}
                          <button class="btn btn-small btn-link-danger" type="submit">Remove</button>
                        </form>` : ''}
                    </li>`)}
                </ul>`}
              ${writable ? html`
                <details class="add-block" ${parties.length <= 1 ? raw('open') : ''}>
                  <summary>Add a party</summary>
                  <form method="post" action="/cases/${kase.id}/parties" class="row-form">
                    ${csrfField(csrf)}
                    ${select({ label: 'Client', name: 'client_id', value: '', required: true,
                               options: clients, includeBlank: 'Choose an existing client' })}
                    ${select({ label: 'Role on this case', name: 'role', value: 'secondary_applicant',
                               includeBlank: false, options: optionsFrom(PARTY_ROLES, PARTY_ROLE_LABELS) })}
                    ${field({ label: 'Note', name: 'notes', maxlength: 200,
                              placeholder: 'e.g. accredited employer, NZ citizen partner' })}
                    <button class="btn btn-primary" type="submit">Add party</button>
                  </form>
                  <p class="hint">Everyone on a matter is a client in their own right — a partner, a
                     child, an employer — so each has their own documents and expiry dates.
                     <a href="/clients/new">Create a client</a> first if they are not on file.</p>
                </details>` : ''}`)}

            ${fees}

            ${card('Tasks', html`
              ${tasks.length === 0 ? emptyState('No tasks on this case yet.') : html`
                <ul class="tasklist">
                  ${tasks.map((t: any) => html`
                    <li class="${t.status === 'done' || t.status === 'cancelled' ? 'task-done' : ''}">
                      <div>
                        <strong>${t.title}</strong>
                        ${badge(TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS] ?? t.status, statusTone(t.status))}
                        <div class="muted small">
                          ${t.due_at ? html`Due ${dateShort(t.due_at)} (${relativeDays(t.due_at)})` : 'No due date'}
                          ${t.assignee_name ? ` · ${t.assignee_name}` : ''}</div>
                        ${t.details ? html`<div class="small prewrap">${t.details}</div>` : ''}
                      </div>
                      ${writable ? html`
                        <div class="task-actions">
                          ${t.status !== 'done' && t.status !== 'cancelled' ? html`
                            <form method="post" action="/tasks/${t.id}/status" class="inline-form">
                              ${csrfField(csrf)}
                              <input type="hidden" name="status" value="done">
                              <input type="hidden" name="return_to" value="/cases/${kase.id}">
                              <button class="btn btn-small btn-secondary" type="submit">Mark done</button>
                            </form>` : ''}
                          <a class="btn btn-small btn-secondary"
                             href="/tasks/${t.id}/edit?return_to=/cases/${kase.id}">Edit</a>
                        </div>` : ''}
                    </li>`)}
                </ul>`}
              ${writable ? html`
                <details class="add-block" ${tasks.length === 0 ? raw('open') : ''}>
                  <summary>Add a task to this case</summary>
                  <form method="post" action="/tasks" class="row-form">
                    ${csrfField(csrf)}
                    <input type="hidden" name="entity_type" value="case">
                    <input type="hidden" name="entity_id" value="${kase.id}">
                    <input type="hidden" name="return_to" value="/cases/${kase.id}">
                    ${field({ label: 'Task', name: 'title', required: true, maxlength: 200,
                              placeholder: 'e.g. Chase employment agreement from employer' })}
                    ${field({ label: 'Due', name: 'due_at', type: 'date' })}
                    ${select({ label: 'Priority', name: 'priority', value: 'normal', includeBlank: false,
                               options: optionsFrom(PRIORITIES, PRIORITY_LABELS) })}
                    ${select({ label: 'Assign to', name: 'assigned_to', required: true, includeBlank: false,
                               value: kase.assigned_to ?? viewer.id, options: users })}
                    ${field({ label: 'Details', name: 'details', type: 'textarea', rows: 2, maxlength: 2000 })}
                    <button class="btn btn-primary" type="submit">Add task</button>
                  </form>
                </details>` : ''}`)}

            ${aiAvailable ? card('Brief me on this matter', html`
              ${brief ? html`
                <p class="lede-sm">${brief.result.summary}</p>
                ${brief.result.next_steps.length ? html`
                  <h4>Next steps it suggests</h4>
                  <ol class="list">${brief.result.next_steps.map((s) => html`<li>${s}</li>`)}</ol>` : ''}
                ${brief.result.risks.length ? html`
                  <h4>Worth watching</h4>
                  <ul class="list">${brief.result.risks.map((s) => html`<li>${s}</li>`)}</ul>` : ''}
                ${brief.result.questions.length ? html`
                  <h4>What the file does not say</h4>
                  <ul class="list">${brief.result.questions.map((s) => html`<li>${s}</li>`)}</ul>` : ''}
                <p class="hint">Drafted ${dateTime(brief.at)} from this file alone. A suggestion,
                   not advice, and nothing has been written to the matter.</p>` : ''}
              ${writable ? html`
                <form method="post" action="/cases/${kase.id}/brief" class="mt">
                  ${csrfField(csrf)}
                  <button class="btn btn-secondary" type="submit">
                    ${brief ? 'Draft it again' : 'Read this file and brief me'}
                  </button>
                  ${brief ? html`
                    <button class="btn btn-primary" type="submit" name="save" value="1">
                      Save the brief as a file note
                    </button>` : ''}
                </form>` : ''}`) : ''}

            ${card('File notes', html`
              ${writable ? html`
                <form method="post" action="/cases/${kase.id}/entries" class="entry-form"
                      enctype="multipart/form-data">
                  ${csrfField(csrf)}
                  ${field({ label: 'Note', name: 'body', type: 'textarea', rows: 4, required: true,
                            maxlength: 20000,
                            placeholder: 'What happened, what was said, what was advised.' })}
                  <div class="row-form">
                    ${select({ label: 'Kind', name: 'kind', value: 'note', includeBlank: false,
                               options: optionsFrom(ENTRY_KINDS.filter((k) => k !== 'system') as any, ENTRY_KIND_LABELS as any) })}
                    ${field({ label: 'It happened on', name: 'occurred_at', type: 'date',
                              value: nowIso().slice(0, 10),
                              hint: 'Backdate a note written up later.' })}
                    ${docsEnabled
                      ? html`<div class="field">
                               <label for="f_attachment">Attach a file</label>
                               <input id="f_attachment" type="file" name="attachment">
                               <p class="hint">Stored against this case and linked from the note.</p>
                             </div>`
                      : html`<div class="field">
                               <label>Attach a file</label>
                               <p class="hint">Document storage is not switched on yet — enable R2 in
                                  Cloudflare and the file box appears here.</p>
                             </div>`}
                  </div>
                  <button class="btn btn-primary" type="submit">Add the note</button>
                  <p class="hint">A note cannot be edited or deleted once saved — the database
                     refuses it, not just this screen. That is what makes the file worth something
                     later. If you get something wrong, add a correction: both stand, in order.</p>
                </form>` : ''}

              ${entries.length === 0 ? emptyState('Nothing recorded yet.') : html`
                <ul class="timeline">
                  ${entries.map((e) => html`
                    <li class="timeline-item">
                      <div class="timeline-meta">
                        ${badge(ENTRY_KIND_LABELS[e.kind] ?? e.kind, e.kind === 'system' ? 'grey' : 'neutral')}
                        <span class="muted small">${dateOrDateTime(e.occurred_at)}${e.author_name ? ` · ${e.author_name}` : ''}</span>
                        ${e.occurred_at.slice(0, 10) !== e.created_at.slice(0, 10)
                          ? html`<span class="muted small">written up ${dateShort(e.created_at)}</span>`
                          : ''}
                      </div>
                      <div class="timeline-body">${e.body}</div>
                      ${e.document_id
                        ? html`<p class="small mt">
                                 <a href="/documents/${e.document_id}">${e.document_name ?? 'Attached file'}</a>
                               </p>`
                        : ''}
                    </li>`)}
                </ul>`}`)}
          </div>

          <div class="col-side">
            ${card('Tags', html`
              ${caseTags.length === 0
                ? html`<p class="muted small">No tags yet.</p>`
                : html`<p class="tag-row">${caseTags.map((tag) => html`
                    ${badge(tag.name, tag.colour)}
                    ${writable ? html`
                      <form method="post" action="/cases/${kase.id}/tags/${tag.id}/remove" class="inline-form">
                        ${csrfField(csrf)}
                        <button class="btn-tag-remove" type="submit" title="Remove ${tag.name}">×</button>
                      </form>` : ''}`)}</p>`}
              ${writable ? html`
                <form method="post" action="/cases/${kase.id}/tags" class="tag-form">
                  ${csrfField(csrf)}
                  <label for="f_tag">Add a tag</label>
                  <input id="f_tag" name="tag" list="tag-options" maxlength="40" required
                         placeholder="Type a new tag or pick one" autocomplete="off">
                  <datalist id="tag-options">
                    ${allTags.map((tag) => html`<option value="${tag.name}"></option>`)}
                  </datalist>
                  <button class="btn btn-secondary btn-small" type="submit">Add</button>
                  <p class="hint">Anything you type that does not exist yet is created.</p>
                </form>` : ''}`)}

            ${card('Key details', html`
              <dl class="kv">
                <dt>Client</dt><dd><a href="/clients/${kase.client_id}">${kase.client_name}</a> <code>${kase.client_ref}</code></dd>
                <dt>Type</dt><dd>${labelFor(types, kase.case_type)}</dd>
                <dt>Priority</dt><dd>${PRIORITY_LABELS[kase.priority as keyof typeof PRIORITY_LABELS] ?? kase.priority}</dd>
                <dt>Owner</dt><dd>${kase.assignee_name ?? 'Unassigned'}</dd>
                <dt>INZ application</dt><dd>${kase.inz_application_number ?? '—'}</dd>
                <dt>INZ client no.</dt><dd>${kase.inz_client_number ?? '—'}</dd>
                <dt>Lodged</dt><dd>${dateShort(kase.lodged_at)}</dd>
                <dt>Due</dt><dd>${dateShort(kase.decision_due_at)}</dd>
                <dt>Decided</dt><dd>${dateShort(kase.decided_at)}</dd>
                <dt>Opened</dt><dd>${dateShort(kase.created_at)}</dd>
              </dl>`)}

            ${card('Next action', html`
              <p>${kase.next_action ?? '—'}</p>
              ${kase.next_action_due
                ? html`<p class="${isOverdue(kase.next_action_due) ? 'warn' : 'muted'}">
                        Due ${dateShort(kase.next_action_due)} (${relativeDays(kase.next_action_due)})</p>`
                : ''}`)}

            ${card('Quotes', quotes.length === 0
              ? emptyState('No quotes on this case.')
              : html`<ul class="list">${quotes.map((qt: any) => html`
                  <li><a href="/quotes/${qt.id}"><code>${qt.ref}</code></a> — ${truncate(qt.description, 40)}
                      <span class="muted small">${qt.status}</span></li>`)}</ul>`)}

            ${card('Summary', html`<p class="prewrap">${kase.summary || '—'}</p>`)}
          </div>
        </div>`);
    });

    // --- Edit ---------------------------------------------------------------
    r.get('/:id/edit', requirePermission('register:write'), async (c) => {
      const kase = await one<CaseRow>(c.env.DB, 'SELECT * FROM cases WHERE id = ?', c.req.param('id')!);
      if (!kase) return c.notFound();
      const [clients, users, types] = await Promise.all([
        clientOptions(c.env), userOptions(c.env), caseTypes(c.env),
      ]);
      return page(c, { title: `Edit ${kase.ref}`, active: '/cases' }, html`
        ${breadcrumbs([{ href: '/cases', label: 'Cases' }, { href: `/cases/${kase.id}`, label: kase.ref }, { label: 'Edit' }])}
        ${pageHeader(`Edit ${kase.ref}`)}
        ${caseForm(c, kase, clients, users, types)}`);
    });

    r.post('/:id', requirePermission('register:write'), async (c) => {
      const types = await caseTypes(c.env);
      const id = c.req.param('id')!;
      const existing = await one<CaseRow>(c.env.DB, 'SELECT * FROM cases WHERE id = ?', id);
      if (!existing) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const v = readCaseForm(f, types);
      if (!f.valid) {
        const [clients, users] = await Promise.all([clientOptions(c.env), userOptions(c.env)]);
        return page(c, { title: 'Edit case', active: '/cases', status: 400 }, html`
          ${pageHeader(`Edit ${existing.ref}`)}${caseForm(c, { ...existing, ...v } as Partial<CaseRow>, clients, users, types, f.errors)}`);
      }

      const policy = await decisionPolicy(c.env);
      const decisionDue = v.decision_due_at
        ?? expectedDecisionDate(v.lodged_at, policy.expectedMonths);
      await run(
        c.env.DB,
        `UPDATE cases SET client_id=?, title=?, case_type=?, priority=?, assigned_to=?,
           inz_application_number=?, inz_client_number=?, lodged_at=?, decision_due_at=?,
           next_action=?, next_action_due=?, summary=?, chase_inz=?, updated_at=?
         WHERE id=?`,
        v.client_id, v.title, v.case_type, v.priority, v.assigned_to || null,
        v.inz_application_number, v.inz_client_number, v.lodged_at, decisionDue,
        v.next_action, v.next_action_due, v.summary, v.chase_inz, nowIso(), id,
      );
      // The chases follow the dates rather than being fired once: moving the
      // expected decision moves them, and turning the chase off withdraws them.
      const matter = await caseForSync(c.env, id);
      if (matter) await syncCaseFollowUps(c.env, matter, policy);
      await auditFrom(c, { action: 'case.updated', entityType: 'case', entityId: id });
      return redirectWith(c, `/cases/${id}`, 'Case updated.');
    });

    // --- Status transitions -------------------------------------------------
    r.post('/:id/status', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const kase = await one<CaseRow>(c.env.DB, 'SELECT * FROM cases WHERE id = ?', id);
      if (!kase) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const status = f.enum('status', CASE_STATUSES, { required: true, label: 'Status' });
      const note = f.optional('note', { max: 500 });
      const decisionDue = f.date('decision_due_at');
      if (!status) return redirectWith(c, `/cases/${id}`, 'Choose a status.', 'err');

      if (!canTransition(kase.status, status)) {
        return redirectWith(
          c, `/cases/${id}`,
          `A case cannot move from ${CASE_STATUS_LABELS[kase.status]} to ${CASE_STATUS_LABELS[status]}.`, 'err',
        );
      }

      // Derived dates: set them when the status implies them, never overwrite
      // a date already recorded.
      const lodgedAt = status === 'lodged' ? (kase.lodged_at ?? nowIso()) : kase.lodged_at;
      const decidedAt = status === 'approved' || status === 'declined' ? (kase.decided_at ?? nowIso()) : kase.decided_at;
      const outcome = status === 'approved' ? 'approved' : status === 'declined' ? 'declined' : kase.outcome;
      const closedAt = status === 'closed' || status === 'withdrawn' ? (kase.closed_at ?? nowIso()) : null;

      // Lodging is the moment an expected decision date becomes meaningful, so
      // it is filled in here when nobody has supplied one.
      const policy = await decisionPolicy(c.env);
      const expected = decisionDue
        ?? kase.decision_due_at
        ?? expectedDecisionDate(lodgedAt ? lodgedAt.slice(0, 10) : null, policy.expectedMonths);

      await run(
        c.env.DB,
        `UPDATE cases SET status=?, lodged_at=?, decided_at=?, outcome=?, closed_at=?, decision_due_at=?, updated_at=? WHERE id=?`,
        status, lodgedAt, decidedAt, outcome, closedAt, expected, nowIso(), id,
      );
      await run(
        c.env.DB,
        'INSERT INTO case_status_history (id, case_id, from_status, to_status, at, by_user_id, note) VALUES (?,?,?,?,?,?,?)',
        newId('csh'), id, kase.status, status, nowIso(), user.id, note,
      );
      await addEntry(c.env, {
        entityType: 'case', entityId: id, kind: 'system',
        body: `Status: ${CASE_STATUS_LABELS[kase.status]} → ${CASE_STATUS_LABELS[status]}${note ? ` — ${note}` : ''}`,
        createdBy: user.id,
      });
      // A decision arriving withdraws the chases; a matter moving into the
      // queue starts them. Either way the schedule is rebuilt from the dates.
      const matter = await caseForSync(c.env, id);
      const chases = matter ? await syncCaseFollowUps(c.env, matter, policy) : null;

      await auditFrom(c, { action: 'case.status_changed', entityType: 'case', entityId: id, meta: { from: kase.status, to: status } });
      return redirectWith(c, `/cases/${id}`,
        `Status updated to ${CASE_STATUS_LABELS[status]}.`
        + (chases?.created ? ` ${chases.created} INZ follow-up${chases.created === 1 ? '' : 's'} scheduled.` : '')
        + (chases?.cancelled ? ` ${chases.cancelled} follow-up${chases.cancelled === 1 ? '' : 's'} withdrawn.` : ''));
    });

    // --- Parties ------------------------------------------------------------
    r.post('/:id/parties', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const kase = await one<{ id: string; ref: string }>(c.env.DB, 'SELECT id, ref FROM cases WHERE id = ?', id);
      if (!kase) return c.notFound();

      const f = new FormReader(await c.req.formData());
      const clientId = f.text('client_id', { required: true, label: 'Client', max: 60 });
      const roleRaw = f.text('role', { required: true, label: 'Role', max: 40 });
      const notes = f.optional('notes', { max: 200 });
      if (!f.valid || !isPartyRole(roleRaw)) {
        return redirectWith(c, `/cases/${id}`, 'Choose a client and a role.', 'err');
      }

      const client = await one<{ full_name: string }>(c.env.DB, 'SELECT full_name FROM clients WHERE id = ?', clientId);
      if (!client) return redirectWith(c, `/cases/${id}`, 'That client no longer exists.', 'err');

      const result = await addParty(c.env, { caseId: id, clientId, role: roleRaw, notes, createdBy: user.id });
      if (!result.ok) return redirectWith(c, `/cases/${id}`, result.reason, 'err');

      await addEntry(c.env, { entityType: 'case', entityId: id, kind: 'system',
        body: `${client.full_name} added as ${PARTY_ROLE_LABELS[roleRaw].toLowerCase()}.`, createdBy: user.id });
      await addEntry(c.env, { entityType: 'client', entityId: clientId, kind: 'system',
        body: `Added to case ${kase.ref} as ${PARTY_ROLE_LABELS[roleRaw].toLowerCase()}.`, createdBy: user.id });
      await auditFrom(c, { action: 'case.party_added', entityType: 'case', entityId: id,
        meta: { clientId, role: roleRaw } });
      return redirectWith(c, `/cases/${id}`, `${client.full_name} added as ${PARTY_ROLE_LABELS[roleRaw].toLowerCase()}.`);
    });

    r.post('/:id/parties/:partyId/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const partyId = c.req.param('partyId')!;
      const user = c.get('user')!;

      const kase = await one<{ client_id: string }>(c.env.DB, 'SELECT client_id FROM cases WHERE id = ?', id);
      if (!kase) return c.notFound();

      const party = await removeParty(c.env, id, partyId);
      if (!party) return redirectWith(c, `/cases/${id}`, 'That party is not on this case.', 'err');
      // The case's own client is the principal applicant and cannot be removed
      // without removing the case; the button is hidden for them, and this is
      // the check behind it.
      if (party.client_id === kase.client_id) {
        await addParty(c.env, { caseId: id, clientId: party.client_id, role: party.role, notes: party.notes, createdBy: user.id });
        return redirectWith(c, `/cases/${id}`, 'The principal applicant cannot be removed from their own case.', 'err');
      }

      await addEntry(c.env, { entityType: 'case', entityId: id, kind: 'system',
        body: `${party.client_name ?? 'A party'} removed from the case.`, createdBy: user.id });
      await auditFrom(c, { action: 'case.party_removed', entityType: 'case', entityId: id,
        meta: { clientId: party.client_id, role: party.role } });
      return redirectWith(c, `/cases/${id}`, 'Party removed.');
    });

    // --- Tags -----------------------------------------------------------------
    r.post('/:id/tags', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const f = new FormReader(await c.req.formData());
      const name = f.text('tag', { required: true, label: 'Tag', max: 40 });
      if (!f.valid) return redirectWith(c, `/cases/${id}`, 'Type a tag.', 'err');

      const tag = await findOrCreateTag(c.env, name, user.id);
      if (!tag) return redirectWith(c, `/cases/${id}`, 'That tag name is empty.', 'err');

      await tagCase(c.env, id, tag.id, user.id);
      await auditFrom(c, { action: 'case.tagged', entityType: 'case', entityId: id, meta: { tag: tag.name } });
      return redirectWith(c, `/cases/${id}`, `Tagged “${tag.name}”.`);
    });

    r.post('/:id/tags/:tagId/remove', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      await untagCase(c.env, id, c.req.param('tagId')!);
      await auditFrom(c, { action: 'case.untagged', entityType: 'case', entityId: id });
      return redirectWith(c, `/cases/${id}`, 'Tag removed.');
    });


    /**
     * Draft a brief on this matter, or save the last one to the file.
     *
     * Two actions on one form because they are two halves of one thought:
     * read the file, then decide whether the reading is worth keeping. Saving
     * writes an ordinary file note — which then cannot be edited, like any
     * other — and says plainly in the note that it was drafted by the AI layer,
     * because a file that does not distinguish what a person wrote from what a
     * model drafted is a file nobody can rely on.
     */
    r.post('/:id/brief', requirePermission('ai:run'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const form = await c.req.formData();

      if (form.get('save')) {
        const existing = await latestBrief(c.env, id);
        if (!existing) return redirectWith(c, `/cases/${id}`, 'There is no brief to save yet.', 'err');
        const lines = [
          'Brief drafted by the AI layer from this file. Reviewed and kept by ' + user.name + '.',
          '',
          existing.result.summary,
        ];
        if (existing.result.next_steps.length) {
          lines.push('', 'Next steps suggested:', ...existing.result.next_steps.map((s) => `- ${s}`));
        }
        if (existing.result.risks.length) {
          lines.push('', 'Worth watching:', ...existing.result.risks.map((s) => `- ${s}`));
        }
        if (existing.result.questions.length) {
          lines.push('', 'Not answered by the file:', ...existing.result.questions.map((s) => `- ${s}`));
        }
        await addEntry(c.env, {
          entityType: 'case', entityId: id, kind: 'note', body: lines.join('\n'), createdBy: user.id,
        });
        await auditFrom(c, { action: 'case.brief_saved', entityType: 'case', entityId: id });
        return redirectWith(c, `/cases/${id}`, 'Brief saved to the file. Like any note, it cannot now be changed.');
      }

      const result = await briefCase(c.env, id, user.id);
      await auditFrom(c, { action: 'case.briefed', entityType: 'case', entityId: id, meta: { ok: result.ok } });
      return result.ok
        ? redirectWith(c, `/cases/${id}`, 'Brief drafted from the file.')
        : redirectWith(c, `/cases/${id}`, result.error, 'err');
    });

    r.post('/:id/entries', requirePermission('register:write'), async (c) => {
      const id = c.req.param('id')!;
      const user = c.get('user')!;
      const exists = await one<{ id: string }>(c.env.DB, 'SELECT id FROM cases WHERE id = ?', id);
      if (!exists) return c.notFound();

      const form = await c.req.formData();
      const f = new FormReader(form);
      const kind = f.enum('kind', ENTRY_KINDS, { fallback: 'note' })!;
      const body = f.text('body', { required: true, label: 'Note', max: 20000 });
      // A note written up on Thursday about a call on Monday belongs on Monday,
      // but the file must still show when it was actually written — the created
      // date records that, and the page shows both when they differ.
      const occurredAt = f.date('occurred_at');
      if (!f.valid) return redirectWith(c, `/cases/${id}`, Object.values(f.errors)[0]!, 'err');

      // The attachment is stored first: if it fails, the note is still written
      // and the person is told, rather than losing what they typed.
      let documentId: string | null = null;
      let attachmentWarning = '';
      const file = form.get('attachment') as unknown as File | string | null;
      if (file && typeof file !== 'string' && file.size > 0) {
        const stored = await storeDocument(c.env, {
          entityType: 'case', entityId: id, file, uploadedBy: user.id,
          description: 'Attached to a file note',
        });
        if (stored && 'error' in stored) attachmentWarning = ` ${stored.error}`;
        else if (stored) documentId = stored.id;
      }

      await addEntry(c.env, {
        entityType: 'case', entityId: id, kind, body, createdBy: user.id,
        occurredAt: occurredAt ? instantForDate(occurredAt) : undefined,
        documentId,
      });
      await run(c.env.DB, 'UPDATE cases SET updated_at = ? WHERE id = ?', nowIso(), id);
      await auditFrom(c, { action: 'case.entry_added', entityType: 'case', entityId: id,
        meta: { kind, documentId } });
      return redirectWith(c, `/cases/${id}`,
        `Note added — it is now part of the file and cannot be changed.${attachmentWarning}`,
        attachmentWarning ? 'err' : 'ok');
    });

    app.route('/cases', r);
  },
};
