/**
 * Module: dashboard and search.
 *
 * The first screen answers one question — what needs attention today — and
 * orders it by consequence: statutory deadlines first, then overdue work, then
 * everything waiting on someone.
 */

import { Hono } from 'hono';
import type { AppContext } from '../../types';
import type { AppModule } from '../../core/module';
import { everyTermClausePlain } from '../../core/search';
import { all, count } from '../../core/db';
import { requireAuth, requirePermission } from '../../core/auth';
import { page } from '../../ui/layout';
import { html, raw } from '../../ui/html';
import {
  badge, card, caseSubline, emptyState, pageHeader, sparkline, stamp, statusTone, table,
} from '../../ui/components';
import { dateShort, isOverdue, money, relativeDays, truncate } from '../../ui/format';
import {
  CASE_STATUS_LABELS, CLIENT_STATUS_LABELS, DEADLINE_CASE_STATUSES,
  INQUIRY_STATUS_LABELS, OPEN_CASE_STATUSES, PRIORITY_LABELS, TASK_STATUS_LABELS,
} from '../../domain';
import { can } from '../../core/rbac';
import { caseTypes, labelFor, termOptions } from '../../core/vocabulary';
import { byWorkingOrder, collectAlerts, documentAlerts, type Alert } from '../alerts';
import { CHANNEL_LABELS } from '../../core/channels';
import { preferencesFor } from '../../core/preferences';
import { pageSizeFor } from '../../ui/pager';

export const dashboardModule: AppModule = {
  name: 'dashboard',
  title: 'Dashboard',
  basePaths: ['/', '/search'],
  nav: [{ href: '/', label: 'Dashboard', permission: 'register:read', order: 100 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const user = c.get('user')!;
      const prefs = await preferencesFor(c.env, user.id);
      const today = new Date().toISOString().slice(0, 10);
      const openPlaceholders = OPEN_CASE_STATUSES.map(() => '?').join(',');

      const [deadlines, overdueTasks, newInquiries, pendingInbox, myCases, statusCounts, sentQuotes, unpaid, expiring,
             everything, approvals, conversations, invoicesLate, lodgedByMonth] =
        await Promise.all([
          all<any>(
            c.env.DB,
            // Ordered in SQL by the due date, which is the only order that
            // needs the database; the reader's other choices are applied below,
            // on a list of at most a few hundred. The old LIMIT 15 was invisible
            // — the card simply stopped, with nothing saying there was more.
            `SELECT k.id, k.ref, k.title, k.descriptor, k.status, k.decision_due_at, k.priority, cl.full_name AS client_name
               FROM cases k JOIN clients cl ON cl.id = k.client_id
              WHERE k.decision_due_at IS NOT NULL AND k.status IN (${openPlaceholders})
              ORDER BY k.decision_due_at LIMIT 300`,
            ...OPEN_CASE_STATUSES,
          ),
          all<any>(
            c.env.DB,
            `SELECT t.id, t.title, t.due_at, t.priority, t.entity_type, t.entity_id, u.name AS assignee_name
               FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
              WHERE t.status IN ('open','in_progress','blocked')
                AND t.due_at IS NOT NULL AND t.due_at <= ?
              ORDER BY t.due_at LIMIT 15`,
            today,
          ),
          all<any>(
            c.env.DB,
            `SELECT id, ref, subject, source, received_at, contact_name FROM inquiries
              WHERE status = 'new' ORDER BY received_at DESC LIMIT 10`,
          ),
          count(c.env.DB, `SELECT COUNT(*) AS n FROM ingest_messages WHERE status = 'pending'`),
          all<any>(
            c.env.DB,
            `SELECT k.id, k.ref, k.title, k.descriptor, k.status, k.next_action, k.next_action_due, cl.full_name AS client_name
               FROM cases k JOIN clients cl ON cl.id = k.client_id
              WHERE k.assigned_to = ? AND k.status IN (${openPlaceholders})
              ORDER BY COALESCE(k.next_action_due, '9999') LIMIT 15`,
            user.id, ...OPEN_CASE_STATUSES,
          ),
          all<{ status: string; n: number }>(
            c.env.DB,
            `SELECT status, COUNT(*) AS n FROM cases WHERE closed_at IS NULL GROUP BY status ORDER BY n DESC`,
          ),
          all<any>(
            c.env.DB,
            `SELECT q.id, q.ref, q.description, q.amount_cents, q.gst_cents, q.disbursements_cents, q.currency,
                    q.valid_until, cl.full_name AS client_name
               FROM quotes q LEFT JOIN clients cl ON cl.id = q.client_id
              WHERE q.status = 'sent' ORDER BY COALESCE(q.valid_until, '9999') LIMIT 10`,
          ),
          all<{ total: number }>(
            c.env.DB,
            `SELECT COALESCE(SUM(gross_cents), 0) AS total FROM fee_items WHERE status = 'invoiced'`,
          ),
          documentAlerts(c.env, 90),
          // Everything with a date, merged and sorted, so the list at the top
          // can be assembled by filtering rather than by asking again.
          collectAlerts(c.env, 90),
          // Waiting for a person: proposals, unanswered conversations, and
          // invoices past their due date. None of these were reachable from
          // this page, which is how a queue becomes a place nobody looks.
          all<any>(
            c.env.DB,
            `SELECT a.id, a.automation_name, a.action_kind, a.subject_label, a.subject_href, a.created_at
               FROM automation_actions a WHERE a.status = 'pending'
              ORDER BY a.created_at LIMIT 8`,
          ),
          all<any>(
            c.env.DB,
            `SELECT t.id, t.channel, t.peer_label, t.peer_id, t.last_message_at,
                    cl.full_name AS client_name,
                    (SELECT COUNT(*) FROM ingest_messages m
                      WHERE m.thread_id = t.id AND m.status = 'pending') AS waiting
               FROM channel_threads t LEFT JOIN clients cl ON cl.id = t.client_id
              WHERE t.status = 'open'
              ORDER BY t.last_message_at DESC LIMIT 8`,
          ),
          all<any>(
            c.env.DB,
            `SELECT i.id, i.ref, i.due_on, i.gross_cents, i.paid_cents, i.currency,
                    cl.full_name AS client_name
               FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
              WHERE i.status IN ('issued','part_paid') AND i.due_on IS NOT NULL AND i.due_on < ?
              ORDER BY i.due_on LIMIT 8`,
            today,
          ),
          // Twelve months of lodgements, for the one trend worth a shape.
          all<{ month: string; n: number }>(
            c.env.DB,
            `SELECT substr(lodged_at, 1, 7) AS month, COUNT(*) AS n FROM cases
              WHERE lodged_at IS NOT NULL AND lodged_at >= ?
              GROUP BY month ORDER BY month`,
            new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10),
          ),
        ]);

      const openTotal = statusCounts.reduce((s, row) => s + row.n, 0);
      const outstanding = unpaid[0]?.total ?? 0;

      // What bites today: everything dated that has arrived or gone past,
      // whatever kind of thing it is. A morning is spent on this list, not on
      // working out which of six panels holds the thing that is late.
      const overdueInvoices = invoicesLate.map((i: any): Alert => ({
        kind: 'quote', severity: 'overdue', date: i.due_on,
        title: `Invoice ${i.ref} — ${i.client_name ?? 'no client'}`,
        detail: `${money(i.gross_cents - i.paid_cents, i.currency)} owing`,
        href: `/invoices/${i.id}`,
      }));
      /*
       * What bites today, in the order a working morning wants it.
       *
       * Sorted by date alone this put the oldest thing first whatever it was —
       * and a matter lodged in 2024 whose record contradicts itself carries a
       * 2024 date, so it sat above a reply due this afternoon, permanently. The
       * practice said so on 3 September. `byWorkingOrder` separates a date that
       * is a deadline from one that is only when the record was made; the
       * reader can override it with the control on the card.
       */
      const needsSort = c.req.query('needs') === 'date' ? 'date' : 'working';
      /*
       * How many rows a dashboard card shows before it says "show all".
       *
       * Twelve was written in and could not be changed, and the practice asked
       * for it: three lines is not enough to plan a morning on. It follows the
       * reader's own "rows per page" preference, so one setting governs every
       * list in the register rather than this one having an opinion of its own.
       */
      const DEFAULT_ROWS = Math.min(pageSizeFor(undefined, prefs['pref.page_size']), 50);
      const needsShowAll = c.req.query('rows') === 'all';
      const needsRows = needsShowAll ? 500 : DEFAULT_ROWS;
      // Priority is a word, not a number, so it is ordered by the register's
      // own ranking rather than alphabetically — "urgent" must not sort under
      // "high" because u comes after h.
      const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
      const deadlineSort = ['priority', 'client'].includes(c.req.query('deadlines') ?? '')
        ? c.req.query('deadlines')! : 'due';
      const sortedDeadlines = [...deadlines].sort((a: any, b: any) => {
        if (deadlineSort === 'priority') {
          const d = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
          // Same priority falls back to the due date, so the control narrows
          // the order rather than replacing it with something arbitrary.
          if (d !== 0) return d;
        }
        if (deadlineSort === 'client') {
          const d = String(a.client_name).localeCompare(String(b.client_name));
          if (d !== 0) return d;
        }
        return String(a.decision_due_at).localeCompare(String(b.decision_due_at));
      });

      /** One spelling of this page's address, so a control keeps the others. */
      const dashHref = (over: Record<string, string>) => {
        const p = new URLSearchParams({
          needs: needsSort, deadlines: deadlineSort,
          ...(needsShowAll ? { rows: 'all' } : {}), ...over,
        });
        for (const [k, v] of [...p]) if (!v) p.delete(k);
        const q = p.toString();
        return q ? `/?${q}` : '/';
      };
      const needsToday = [...everything, ...overdueInvoices]
        .filter((a) => a.date <= today)
        .sort(needsSort === 'date'
          ? (a, b) => a.date.localeCompare(b.date)
          : byWorkingOrder);

      const weekAway = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      // Two degrees rather than one: already late, and late this week.
      const tone = (rows: Array<{ date: string }>): string => {
        if (rows.some((x) => x.date < today)) return 'stat-urgent';
        return rows.some((x) => x.date <= weekAway) ? 'stat-warn' : '';
      };

      const months = lodgedByMonth.map((m) => m.n);
      const monthName = (key: string): string =>
        new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-NZ', { month: 'short', timeZone: 'UTC' });

      return page(c, { title: 'Dashboard', active: '/' }, html`
        ${pageHeader(`Good day, ${user.name.split(' ')[0]}`, 'What needs attention.')}

        ${'' /* The figures carry their own urgency: red once something is late,
                 amber when it bites this week, quiet otherwise. A count on its
                 own says how many, which is the least useful half of the
                 answer. */}
        <div class="fee-summary">
          <div class="stat"><span class="stat-label">Open cases</span><span class="stat-value">${openTotal}</span></div>
          <div class="stat ${tone(deadlines.map((d: any) => ({ date: d.decision_due_at })))}">
            <span class="stat-label">Deadlines tracked</span><span class="stat-value">${deadlines.length}</span></div>
          <div class="stat ${tone(overdueTasks.map((t: any) => ({ date: t.due_at })))}">
            <span class="stat-label">Tasks due</span><span class="stat-value">${overdueTasks.length}</span></div>
          <div class="stat ${pendingInbox ? 'stat-warn' : ''}">
            <span class="stat-label">Inbox</span><span class="stat-value">${pendingInbox}</span></div>
          <div class="stat ${tone(expiring.map((e) => ({ date: e.date })))}">
            <span class="stat-label">Documents expiring</span><span class="stat-value">${expiring.length}</span></div>
          <div class="stat ${invoicesLate.length ? 'stat-urgent' : ''}">
            <span class="stat-label">Invoiced unpaid</span><span class="stat-value">${money(outstanding)}</span>
            ${invoicesLate.length
              ? html`<span class="stat-label warn">${invoicesLate.length} overdue</span>` : ''}</div>
        </div>

        ${'' /* One list, every source, sorted by date. A morning is spent on
                 what has arrived or gone past — not on working out which of
                 eight panels holds the thing that is late. */}
        ${needsToday.length === 0
          ? card('Needs you today', emptyState('Nothing overdue and nothing due today. '
              + 'Everything ahead is on the panels below.'))
          : card(`Needs you today — ${needsToday.length}`, html`
              ${'' /* Ordinary links, not a script: the register works with
                       scripting off, and a control that silently does nothing
                       is worse than no control. */}
              <div class="filters">
                <span class="hint">Order:</span>
                <a class="${needsSort === 'working' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}"
                   href="${dashHref({ needs: 'working' })}">What is late first</a>
                <a class="${needsSort === 'date' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}"
                   href="${dashHref({ needs: 'date' })}">Oldest date first</a>
                ${needsToday.length > needsRows
                  ? html`<a class="btn btn-link" href="${dashHref({ rows: 'all' })}">
                           Show all ${String(needsToday.length)}</a>`
                  : needsShowAll && needsToday.length > DEFAULT_ROWS
                    ? html`<a class="btn btn-link" href="${dashHref({ rows: '' })}">Show fewer</a>`
                    : ''}
              </div>
              ${table([
              { label: 'Due', width: '16' },
              { label: 'What', width: '50' },
              { label: 'Detail', width: '34', hideOn: 'sm' },
            ], needsToday.slice(0, needsRows).map((a) => html`
              <tr class="${a.date < today ? 'row-urgent' : ''}">
                <td class="small ${a.date < today ? 'warn' : ''}">${dateShort(a.date)}
                  <div class="muted">${relativeDays(a.date)}</div></td>
                <td><a class="clamp-2" href="${a.href}">${a.title}</a>
                  <div class="row-meta show-sm"><span class="muted">${a.detail}</span></div></td>
                <td class="small muted col-sm-hide clamp-2">${a.detail}</td>
              </tr>`), { fixed: true })}`)}

        <div class="cols">
          <div class="col-main">
            ${card(`Deadlines — ${deadlines.length}`, deadlines.length === 0
              ? emptyState('No dated deadlines on open cases.')
              : html`
              <div class="filters">
                <span class="hint">Order:</span>
                ${([['due', 'Soonest first'], ['priority', 'Priority'], ['client', 'Client']] as const)
                  .map(([id, label]) => html`
                    <a class="${deadlineSort === id ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}"
                       href="${dashHref({ deadlines: id })}">${label}</a>`)}
                ${deadlines.length > needsRows
                  ? html`<a class="btn btn-link" href="${dashHref({ rows: 'all' })}">
                           Show all ${String(deadlines.length)}</a>`
                  : ''}
              </div>
              ${table(
              ['Due', 'Case', 'Client', 'Status'],
              sortedDeadlines.slice(0, needsRows).map((d: any) => html`
                <tr class="${isOverdue(d.decision_due_at) ? 'row-urgent' : ''}">
                  <td class="small ${isOverdue(d.decision_due_at) ? 'warn' : ''}">
                    ${dateShort(d.decision_due_at)}<div class="muted">${relativeDays(d.decision_due_at)}</div></td>
                  <td><a href="/cases/${d.id}">${d.title}</a>
                      ${caseSubline(d.descriptor, d.ref)}</td>
                  <td class="small">${d.client_name}</td>
                  <td>${badge(CASE_STATUS_LABELS[d.status as keyof typeof CASE_STATUS_LABELS] ?? d.status, statusTone(d.status))}
                      ${DEADLINE_CASE_STATUSES.includes(d.status) ? badge('response required', 'red') : ''}</td>
                </tr>`),
            )}`)}

            ${card('Tasks due or overdue', overdueTasks.length === 0 ? emptyState('Nothing due.') : table(
              ['Due', 'Task', 'Owner'],
              overdueTasks.map((t: any) => html`
                <tr class="${isOverdue(t.due_at) ? 'row-urgent' : ''}">
                  <td class="small">${dateShort(t.due_at)}<div class="muted">${relativeDays(t.due_at)}</div></td>
                  <td>${t.title}
                    ${t.priority !== 'normal' ? badge(PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS], t.priority === 'urgent' ? 'red' : 'amber') : ''}
                    ${t.entity_type === 'case' ? html`<div class="muted small"><a href="/cases/${t.entity_id}">open case</a></div>` : ''}</td>
                  <td class="small">${t.assignee_name ?? '—'}</td>
                </tr>`),
            ))}

            ${card('My open cases', myCases.length === 0 ? emptyState('Nothing assigned to you.') : table(
              ['Case', 'Client', 'Status', 'Next action'],
              myCases.map((k: any) => html`
                <tr>
                  <td><a href="/cases/${k.id}">${k.title}</a>${caseSubline(k.descriptor, k.ref)}</td>
                  <td class="small">${k.client_name}</td>
                  <td>${badge(CASE_STATUS_LABELS[k.status as keyof typeof CASE_STATUS_LABELS] ?? k.status, statusTone(k.status))}</td>
                  <td class="small">${k.next_action ? html`${truncate(k.next_action, 50)}
                    <div class="muted">${dateShort(k.next_action_due)}</div>` : '—'}</td>
                </tr>`),
            ))}
          </div>

          <div class="col-side">
            ${'' /* Three things that wait on a person rather than on a date,
                     and were reachable only from pages nobody opens first. */}
            ${approvals.length > 0 ? card(`Waiting for you — ${approvals.length}`, html`
              <ul class="list">${approvals.map((a: any) => html`
                <li>
                  <a href="/workflows">${a.action_kind === 'task' ? 'Task' :
                     a.action_kind === 'email' ? 'Email' : 'Digest'}: ${truncate(a.subject_label, 40)}</a>
                  <div class="muted small">${a.automation_name}</div>
                </li>`)}</ul>
              <p class="hint"><a href="/workflows">Approve or dismiss</a></p>`) : ''}

            ${invoicesLate.length > 0 ? card(`Invoices overdue — ${invoicesLate.length}`, html`
              <ul class="list">${invoicesLate.map((i: any) => html`
                <li><a href="/invoices/${i.id}"><code>${i.ref}</code> ${i.client_name ?? ''}</a>
                    <div class="muted small warn">
                      ${money(i.gross_cents - i.paid_cents, i.currency)} · due ${dateShort(i.due_on)}
                      · ${relativeDays(i.due_on)}</div></li>`)}</ul>`) : ''}

            ${conversations.filter((t: any) => t.waiting > 0).length > 0
              ? card('Conversations waiting', html`
                <ul class="list">${conversations.filter((t: any) => t.waiting > 0).map((t: any) => html`
                  <li><a href="/inbox/threads/${t.id}">${t.peer_label ?? t.peer_id}</a>
                      <div class="muted small">
                        ${CHANNEL_LABELS[t.channel as keyof typeof CHANNEL_LABELS] ?? t.channel}
                        ${t.client_name ? ` · ${t.client_name}` : ''}
                        · ${t.waiting} unanswered</div></li>`)}</ul>`)
              : ''}

            ${months.length >= 2 ? card('Matters lodged', html`
              ${sparkline(months, { label: `Matters lodged per month over the last ${months.length} months` })}
              <div class="sparkline-scale">
                <span>${monthName(lodgedByMonth[0]!.month)}</span>
                <span>${months.reduce((a, b) => a + b, 0)} in ${months.length} months</span>
                <span>${monthName(lodgedByMonth[lodgedByMonth.length - 1]!.month)}</span>
              </div>`) : ''}

            ${card('Documents expiring', expiring.length === 0
              ? emptyState('No passports, visas, police or medical certificates expiring in the next 90 days.')
              : html`
                <ul class="list">${expiring.slice(0, 8).map((e) => html`
                  <li><a href="${e.href}">${e.title}</a>
                      <div class="muted small ${e.severity === 'overdue' ? 'warn' : ''}">
                        ${dateShort(e.date)} · ${relativeDays(e.date)}</div></li>`)}</ul>
                <p class="hint"><a href="/alerts">See every deadline and expiry</a></p>`)}

            ${card('New inquiries', newInquiries.length === 0 ? emptyState('Nothing new.') : html`
              <ul class="list">${newInquiries.map((i: any) => html`
                <li><a href="/inquiries/${i.id}">${truncate(i.subject ?? i.contact_name ?? i.ref, 44)}</a>
                    <div class="muted small">${i.source} · ${stamp(i.received_at)}</div></li>`)}</ul>`)}

            ${pendingInbox > 0 && can(user, 'ingest:triage')
              ? card('Inbox', html`<p>${pendingInbox} captured message(s) awaiting triage.</p>
                                    <p><a class="btn btn-secondary" href="/inbox">Open the inbox</a></p>`)
              : ''}

            ${card('Case load', statusCounts.length === 0 ? emptyState('No open cases.') : html`
              <ul class="list">${statusCounts.map((s) => html`
                <li><a href="/cases?status=${s.status}&scope=all">${CASE_STATUS_LABELS[s.status as keyof typeof CASE_STATUS_LABELS] ?? s.status}</a>
                    <span class="muted">${s.n}</span></li>`)}</ul>`)}

            ${card('Quotes awaiting a reply', sentQuotes.length === 0 ? emptyState('None outstanding.') : html`
              <ul class="list">${sentQuotes.map((q: any) => html`
                <li><a href="/quotes/${q.id}">${truncate(q.description, 40)}</a>
                    <div class="muted small">${q.client_name ?? ''} ·
                      ${money(q.amount_cents + q.gst_cents + q.disbursements_cents, q.currency)}
                      ${q.valid_until ? ` · expires ${dateShort(q.valid_until)}` : ''}</div></li>`)}</ul>`)}
          </div>
        </div>`);
    });

    // --- Global search ------------------------------------------------------
    r.get('/search', requirePermission('register:read'), async (c) => {
      const types = await caseTypes(c.env);
      const q = (c.req.query('q') ?? '').trim();
      if (!q) return page(c, { title: 'Search', active: '/' }, html`
        ${pageHeader('Search')}
        <form method="get" action="/search" class="filters">
          <input type="search" name="q" placeholder="Name, reference, email, phone, INZ number" autofocus>
          <button class="btn btn-primary" type="submit">Search</button>
        </form>`);

      // Every word, in any order — the same rule as the rest of the register.
      const cli = everyTermClausePlain(['full_name', 'email', 'phone', 'ref'], q);
      const kase = everyTermClausePlain(
        ['k.title', 'k.ref', 'k.inz_application_number', 'k.inz_client_number',
         'cl.full_name'], q);
      const inq = everyTermClausePlain(
        ['subject', 'body', 'ref', 'contact_name', 'contact_email'], q);
      const [clients, cases, inquiries] = await Promise.all([
        all<any>(c.env.DB,
          `SELECT id, ref, full_name, email, phone, status FROM clients
            WHERE ${cli.sql} LIMIT 25`, ...cli.params),
        all<any>(c.env.DB,
          `SELECT k.id, k.ref, k.title, k.status, k.case_type, cl.full_name AS client_name
             FROM cases k JOIN clients cl ON cl.id = k.client_id
            WHERE ${kase.sql} LIMIT 25`, ...kase.params),
        all<any>(c.env.DB,
          `SELECT id, ref, subject, status, contact_name, contact_email FROM inquiries
            WHERE ${inq.sql} LIMIT 25`, ...inq.params),
      ]);

      return page(c, { title: `Search: ${q}`, active: '/' }, html`
        ${pageHeader('Search', `Results for “${q}”`)}
        <form method="get" action="/search" class="filters">
          <input type="search" name="q" value="${q}" placeholder="Name, reference, email, phone, INZ number">
          <button class="btn btn-primary" type="submit">Search</button>
        </form>

        ${card('Clients', clients.length === 0 ? emptyState('No matching clients.') : table(
          ['Reference', 'Name', 'Contact', 'Status'],
          clients.map((row: any) => html`
            <tr>
              <td><a href="/clients/${row.id}"><code>${row.ref}</code></a></td>
              <td><a href="/clients/${row.id}">${row.full_name}</a></td>
              <td class="small">${row.email ?? row.phone ?? '—'}</td>
              <td>${badge(CLIENT_STATUS_LABELS[row.status as keyof typeof CLIENT_STATUS_LABELS] ?? row.status, statusTone(row.status))}</td>
            </tr>`)))}

        ${card('Cases', cases.length === 0 ? emptyState('No matching cases.') : table(
          ['Reference', 'Matter', 'Client', 'Status'],
          cases.map((row: any) => html`
            <tr>
              <td><a href="/cases/${row.id}"><code>${row.ref}</code></a></td>
              <td><a href="/cases/${row.id}">${row.title}</a>
                  <div class="muted small">${labelFor(types, row.case_type)}</div></td>
              <td class="small">${row.client_name}</td>
              <td>${badge(CASE_STATUS_LABELS[row.status as keyof typeof CASE_STATUS_LABELS] ?? row.status, statusTone(row.status))}</td>
            </tr>`)))}

        ${card('Inquiries', inquiries.length === 0 ? emptyState('No matching inquiries.') : table(
          ['Reference', 'Subject', 'From', 'Status'],
          inquiries.map((row: any) => html`
            <tr>
              <td><a href="/inquiries/${row.id}"><code>${row.ref}</code></a></td>
              <td><a href="/inquiries/${row.id}">${truncate(row.subject, 60) || '(no subject)'}</a></td>
              <td class="small">${row.contact_name ?? row.contact_email ?? '—'}</td>
              <td>${badge(INQUIRY_STATUS_LABELS[row.status as keyof typeof INQUIRY_STATUS_LABELS] ?? row.status, statusTone(row.status))}</td>
            </tr>`)))}`);
    });

    app.route('/', r);
  },
};
