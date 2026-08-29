/**
 * Module: alerts.
 *
 * One page answering "what is about to go wrong". A practice loses matters to
 * dates, not to decisions: a police certificate that ages out before
 * lodgement, a passport that expires mid-application, an RFI deadline, a task
 * nobody picked up. Those live in four different tables, so this module
 * gathers them into a single list ordered by how soon they bite.
 *
 * Nothing here stores state — it is a read-only view over the register, so it
 * can never disagree with the records it summarises.
 */

import { Hono } from 'hono';
import type { AppContext, Env } from '../../types';
import type { AppModule } from '../../core/module';
import type { SettingsGroup } from '../../core/settings';
import { all } from '../../core/db';
import { settingValue } from '../../core/settings';
import { requireAuth, requirePermission } from '../../core/auth';
import { page } from '../../ui/layout';
import { html, raw, type Raw } from '../../ui/html';
import { badge, card, emptyState, pageHeader, table } from '../../ui/components';
import { dateShort, relativeDays } from '../../ui/format';
import { CASE_STATUS_LABELS, DEADLINE_CASE_STATUSES, OPEN_CASE_STATUSES } from '../../domain';
import { pendingProposalCount } from '../../core/automations';

export type AlertKind =
  | 'case_deadline' | 'task' | 'document' | 'quote'
  /** An open matter nothing has happened on for a while. */
  | 'quiet'
  /** A matter whose own recorded facts disagree with each other. */
  | 'contradiction';
export type AlertSeverity = 'overdue' | 'urgent' | 'soon';

export interface Alert {
  kind: AlertKind;
  severity: AlertSeverity;
  /** ISO date the thing is due or expires. */
  date: string;
  title: string;
  detail: string;
  href: string;
}

const KIND_LABELS: Record<AlertKind, string> = {
  case_deadline: 'Case deadline',
  task: 'Task',
  document: 'Document expiry',
  quote: 'Quote expiry',
  quiet: 'Gone quiet',
  contradiction: 'Does not add up',
};

/** Exposed for the tests, which check that every kind is named. */
export const KIND_LABELS_FOR_TEST = KIND_LABELS;

const SEVERITY_TONES: Record<AlertSeverity, 'red' | 'amber' | 'neutral'> = {
  overdue: 'red', urgent: 'amber', soon: 'neutral',
};

const URGENT_DAYS = 14;

function severityFor(date: string, today: string): AlertSeverity {
  if (date < today) return 'overdue';
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  return days <= URGENT_DAYS ? 'urgent' : 'soon';
}

/** Today and the horizon, as plain YYYY-MM-DD so they compare with stored dates. */
/** A date shifted by whole days, as an ISO date. */
function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) + days * 86_400_000)
    .toISOString().slice(0, 10);
}

/** Whole days from one ISO date to another, negative if the second is earlier. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`))
    / 86_400_000,
  );
}

/**
 * Which of the file's facts disagree.
 *
 * Named precisely rather than "something is wrong": a row nobody can act on
 * without opening the record is a row people learn to skip, and the whole
 * argument for putting these beside the dates is that they are as checkable as
 * a date is.
 */
function describeContradiction(k: any, today: string): string {
  if (k.decided_at && k.lodged_at && String(k.decided_at) < String(k.lodged_at)) {
    return `decided ${dateShort(k.decided_at)} but lodged ${dateShort(k.lodged_at)}`;
  }
  if ((k.status === 'approved' || k.status === 'declined') && !k.decided_at) {
    return `marked ${CASE_STATUS_LABELS[k.status as keyof typeof CASE_STATUS_LABELS] ?? k.status}`
      + ' with no decision date';
  }
  if (k.lodged_at && String(k.lodged_at).slice(0, 10) > today) {
    return `lodged date is in the future (${dateShort(k.lodged_at)})`;
  }
  return 'the recorded dates disagree';
}

function window(horizonDays: number): { today: string; horizon: string } {
  const now = Date.now();
  return {
    today: new Date(now).toISOString().slice(0, 10),
    horizon: new Date(now + horizonDays * 86_400_000).toISOString().slice(0, 10),
  };
}

/**
 * Client identity and compliance documents due to expire.
 *
 * One UNION rather than five queries: each column is a different document but
 * they answer the same question, and the database is better placed to merge
 * and order them than we are.
 */
export async function documentAlerts(env: Env, horizonDays = 90): Promise<Alert[]> {
  const { today, horizon } = window(horizonDays);

  const rows = await all<{ id: string; ref: string; full_name: string; document: string; expires: string }>(
    env.DB,
    `SELECT c.id, c.ref, c.full_name,
            'Passport' || CASE WHEN p.country IS NULL THEN '' ELSE ' (' || p.country || ')' END AS document,
            p.expires_on AS expires
       FROM client_passports p JOIN clients c ON c.id = p.client_id
      WHERE p.status = 'held' AND p.expires_on IS NOT NULL AND p.expires_on <= ?1
        AND c.status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Current visa', current_visa_expiry FROM clients
       WHERE current_visa_expiry IS NOT NULL AND current_visa_expiry <= ?1 AND status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Police certificate', police_certificate_expiry FROM clients
       WHERE police_certificate_expiry IS NOT NULL AND police_certificate_expiry <= ?1 AND status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Medical certificate', medical_certificate_expiry FROM clients
       WHERE medical_certificate_expiry IS NOT NULL AND medical_certificate_expiry <= ?1 AND status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Chest x-ray', chest_xray_expiry FROM clients
       WHERE chest_xray_expiry IS NOT NULL AND chest_xray_expiry <= ?1 AND status != 'archived'
     ORDER BY expires
     LIMIT 200`,
    horizon,
  );

  return rows.map((row) => ({
    kind: 'document' as const,
    severity: severityFor(row.expires, today),
    date: row.expires,
    title: `${row.document} — ${row.full_name}`,
    detail: row.ref,
    href: `/clients/${row.id}`,
  }));
}

/** Everything with a date attached, in one list. */
export async function collectAlerts(env: Env, horizonDays = 90): Promise<Alert[]> {
  const { today, horizon } = window(horizonDays);
  // Read here rather than passed in: three pages call this, and a threshold
  // that meant one thing on the dashboard and another on the alerts page would
  // be a bug nobody could see.
  const quietDays = Number(
    await settingValue(env, ALERT_SETTINGS.settings.find((d) => d.key === 'alerts.quiet_days')!),
  ) || 10;
  const openPlaceholders = OPEN_CASE_STATUSES.map(() => '?').join(',');

  const [cases, tasks, quotes, documents, quiet, contradictions] = await Promise.all([
    all<any>(
      env.DB,
      `SELECT k.id, k.ref, k.title, k.descriptor, k.status, k.decision_due_at, cl.full_name AS client_name
         FROM cases k JOIN clients cl ON cl.id = k.client_id
        WHERE k.decision_due_at IS NOT NULL AND k.decision_due_at <= ?
          AND k.status IN (${openPlaceholders})
        ORDER BY k.decision_due_at LIMIT 100`,
      horizon, ...OPEN_CASE_STATUSES,
    ),
    all<any>(
      env.DB,
      `SELECT t.id, t.title, t.due_at, t.entity_type, t.entity_id, u.name AS assignee_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.status IN ('open','in_progress','blocked')
          AND t.due_at IS NOT NULL AND t.due_at <= ?
        ORDER BY t.due_at LIMIT 100`,
      horizon,
    ),
    all<any>(
      env.DB,
      `SELECT q.id, q.ref, q.description, q.valid_until, cl.full_name AS client_name
         FROM quotes q LEFT JOIN clients cl ON cl.id = q.client_id
        WHERE q.status = 'sent' AND q.valid_until IS NOT NULL AND q.valid_until <= ?
        ORDER BY q.valid_until LIMIT 100`,
      horizon,
    ),
    documentAlerts(env, horizonDays),

    // Two things a date cannot tell you.
    //
    // Every other row here answers "what is due". These answer "what is
    // wrong", which is how matters actually go astray: not by a missed
    // deadline, but by a file nobody has touched, or one whose own record
    // contradicts itself. Both are plain queries — certain, checkable at a
    // glance, and free — which is why they belong beside the dates rather than
    // in a queue of suggestions.
    all<any>(
      env.DB,
      `SELECT k.id, k.ref, k.title, k.descriptor, k.status, cl.full_name AS client_name,
              MAX(COALESCE(
                (SELECT MAX(e.occurred_at) FROM entries e
                  WHERE e.entity_type = 'case' AND e.entity_id = k.id), ''),
                COALESCE((SELECT MAX(h.at) FROM case_status_history h WHERE h.case_id = k.id), ''),
                COALESCE((SELECT MAX(t.updated_at) FROM tasks t
                           WHERE t.entity_type = 'case' AND t.entity_id = k.id), ''),
                k.created_at) AS last_touched
         FROM cases k JOIN clients cl ON cl.id = k.client_id
        WHERE k.status IN (${openPlaceholders})
        GROUP BY k.id
       HAVING SUBSTR(last_touched, 1, 10) <= ?
        ORDER BY last_touched LIMIT 100`,
      ...OPEN_CASE_STATUSES, shiftDays(today, -quietDays),
    ),
    all<any>(
      env.DB,
      `SELECT k.id, k.ref, k.title, k.status, cl.full_name AS client_name,
              k.lodged_at, k.decided_at, k.updated_at,
              (SELECT MIN(h.at) FROM case_status_history h
                WHERE h.case_id = k.id AND h.to_status = 'lodged') AS history_lodged
         FROM cases k JOIN clients cl ON cl.id = k.client_id
        WHERE (k.decided_at IS NOT NULL AND k.lodged_at IS NOT NULL AND k.decided_at < k.lodged_at)
           OR (k.status IN ('approved','declined') AND k.decided_at IS NULL)
           OR (k.lodged_at IS NOT NULL AND SUBSTR(k.lodged_at, 1, 10) > ?)
        ORDER BY k.ref LIMIT 100`,
      today,
    ),
  ]);

  const alerts: Alert[] = [
    ...cases.map((k: any) => ({
      kind: 'case_deadline' as const,
      severity: severityFor(k.decision_due_at, today),
      date: k.decision_due_at,
      // The title names the matter by its type and client, so appending the
      // client again said it twice. The client moves to the detail line, where
      // it is still there for a title somebody wrote their own way.
      title: k.title,
      detail: `${k.descriptor ? `${k.descriptor} · ` : ''}${k.client_name} · ${k.ref} · `
        + `${CASE_STATUS_LABELS[k.status as keyof typeof CASE_STATUS_LABELS] ?? k.status}`
        + (DEADLINE_CASE_STATUSES.includes(k.status) ? ' · response required' : ''),
      href: `/cases/${k.id}`,
    })),
    ...tasks.map((t: any) => ({
      kind: 'task' as const,
      severity: severityFor(t.due_at, today),
      date: t.due_at,
      title: t.title,
      detail: t.assignee_name ? `Assigned to ${t.assignee_name}` : 'Unassigned',
      href: t.entity_type === 'case' ? `/cases/${t.entity_id}` : '/tasks',
    })),
    ...quotes.map((q: any) => ({
      kind: 'quote' as const,
      severity: severityFor(q.valid_until, today),
      date: q.valid_until,
      title: `Quote expiring — ${q.client_name ?? q.ref}`,
      detail: `${q.ref} · awaiting a reply`,
      href: `/quotes/${q.id}`,
    })),
    ...documents,
    ...quiet.map((k: any) => {
      const on = String(k.last_touched).slice(0, 10);
      return {
        kind: 'quiet' as const,
        // Judged on how long the silence has run, not on a due date — there is
        // no due date, which is the entire point of the row.
        severity: (daysBetween(on, today) >= quietDays * 2 ? 'overdue' : 'urgent') as AlertSeverity,
        date: on,
        title: k.title,
        detail: `${k.descriptor ? `${k.descriptor} · ` : ''}${k.client_name} · ${k.ref} · `
          + `nothing since ${dateShort(on)}`,
        href: `/cases/${k.id}`,
      };
    }),
    ...contradictions.map((k: any) => ({
      kind: 'contradiction' as const,
      // Always pressing and never overdue: it is not late, it is wrong, and a
      // record that contradicts itself cannot be relied on until somebody
      // looks.
      severity: 'urgent' as AlertSeverity,
      date: String(k.lodged_at ?? k.updated_at ?? today).slice(0, 10),
      title: k.title,
      detail: `${k.client_name} · ${k.ref} · ${describeContradiction(k, today)}`,
      href: `/cases/${k.id}`,
    })),
  ];

  return alerts.sort((a, b) => a.date.localeCompare(b.date));
}

export function countBySeverity(alerts: Alert[]): Record<AlertSeverity, number> {
  return alerts.reduce(
    (acc, alert) => ({ ...acc, [alert.severity]: acc[alert.severity] + 1 }),
    { overdue: 0, urgent: 0, soon: 0 } as Record<AlertSeverity, number>,
  );
}

export const ALERT_SETTINGS: SettingsGroup = {
  id: 'alerts',
  title: 'Alerts',
  description: 'How far ahead the register looks, and what counts as pressing.',
  order: 30,
  settings: [
    { key: 'alerts.horizon_days', type: 'integer', label: 'Look ahead (days)',
      default: '90', min: 7, max: 365,
      help: 'The default window on the alerts page and the dashboard.' },
    { key: 'alerts.urgent_days', type: 'integer', label: 'Treat as urgent within (days)',
      default: '14', min: 1, max: 90,
      help: 'Anything due inside this window is counted as pressing rather than upcoming.' },
    { key: 'alerts.quiet_days', type: 'integer', label: 'Call a matter quiet after (days)',
      default: '10', min: 3, max: 365,
      help: 'An open matter with no note, no status change and no task activity for this long '
        + 'is listed under “Gone quiet”. Nothing is due on it — that is the point. Matters are '
        + 'rarely lost to a missed deadline; they are lost to nobody looking.' },
  ],
};

/**
 * The three figures over the alerts bar.
 *
 * Shared with the approvals queue for the same reason the bar is: a page in the
 * alerts family that drops them looks like a different page, and the figures
 * vanishing on a click reads as something having gone wrong rather than as
 * having moved. They count the whole window, not the tab being shown, so they
 * mean the same thing wherever you are standing.
 */
export function alertCounters(alerts: Alert[]): Raw {
  const counts = countBySeverity(alerts);
  return html`<div class="fee-summary">
    <div class="stat ${counts.overdue ? 'stat-warn' : ''}">
      <span class="stat-label">Overdue</span><span class="stat-value">${counts.overdue}</span></div>
    <div class="stat ${counts.urgent ? 'stat-warn' : ''}">
      <span class="stat-label">Within ${URGENT_DAYS} days</span><span class="stat-value">${counts.urgent}</span></div>
    <div class="stat"><span class="stat-label">Later</span><span class="stat-value">${counts.soon}</span></div>
  </div>`;
}

/**
 * The one bar of tabs the alerts family uses.
 *
 * Shared with the approvals queue rather than copied, because a tab that leads
 * to a page wearing a *different* bar reads as a trapdoor: you land somewhere
 * with no visible way back to where you were. That already happened once with
 * Automations. Here the bar stays put and only the current tab moves, so
 * "For approval" is a place inside Alerts rather than a different room.
 *
 * The counts come from the list being shown, not from a second query that might
 * disagree with it.
 */
export function alertTabs(
  opts: { alerts: Alert[]; awaiting: number; horizon: number; current: string },
): Raw {
  const views = [
    { id: '', label: 'Everything', count: opts.alerts.length },
    ...(Object.keys(KIND_LABELS) as AlertKind[]).map((k) => ({
      id: k as string, label: KIND_LABELS[k],
      count: opts.alerts.filter((a) => a.kind === k).length,
    })),
  ];
  return html`<nav class="tabs">
    ${views.map((v) => html`
      <a class="${v.id === opts.current ? 'tab current' : 'tab'}"
         href="${`/alerts?kind=${v.id}&days=${opts.horizon}`}">${v.label} <span class="muted">${v.count}</span></a>`)}
    <a class="${opts.current === 'approval' ? 'tab current' : 'tab'}"
       href="/workflows">For approval <span class="muted">${opts.awaiting}</span></a>
  </nav>`;
}

export const alertsModule: AppModule = {
  name: 'alerts',
  title: 'Alerts',
  basePaths: ['/alerts'],
  settings: [ALERT_SETTINGS],
  nav: [{ href: '/alerts', label: 'Alerts', permission: 'register:read', order: 98 }],

  register(app) {
    const r = new Hono<AppContext>();
    r.use('*', requireAuth);

    r.get('/', requirePermission('register:read'), async (c) => {
      const horizon = Math.min(365, Math.max(7, Number(c.req.query('days') ?? '90') || 90));
      const kindFilter = c.req.query('kind') ?? '';

      const [alerts, awaiting] = await Promise.all([
        collectAlerts(c.env, horizon),
        // What the register would like to do about all this. Alerts are what is
        // coming; the queue is what somebody has proposed doing, so the two
        // belong on one bar rather than in two places nobody connects.
        pendingProposalCount(c.env),
      ]);
      const shown = kindFilter && kindFilter in KIND_LABELS
        ? alerts.filter((a) => a.kind === kindFilter)
        : alerts;
      return page(c, { title: 'Alerts', active: '/alerts' }, html`
        ${pageHeader('Alerts', `Everything with a date attached, across the whole register, for the next ${horizon} days.`)}
        ${alertCounters(alerts)}
        ${alertTabs({ alerts, awaiting, horizon, current: kindFilter })}
        <form method="get" action="/alerts" class="filters" data-live-search>
          <input type="hidden" name="kind" value="${kindFilter}">
          <select name="days">
            ${[30, 60, 90, 180, 365].map((d) =>
              html`<option value="${d}" ${d === horizon ? raw('selected') : ''}>Next ${d} days</option>`)}
          </select>
          <button class="btn btn-secondary js-hide" type="submit">Apply</button>
        </form>

        <div data-live-results>
        ${shown.length === 0
          ? card('Nothing due', emptyState('No deadlines, expiries or overdue tasks in this window.'))
          : table([
              { label: 'Due', width: '16' },
              { label: 'What', width: '42' },
              { label: 'Type', width: '18', hideOn: 'sm' },
              { label: 'Detail', width: '24', hideOn: 'sm' },
            ], shown.map((alert) => html`
              <tr class="${alert.severity === 'overdue' ? 'row-urgent' : ''}">
                <td class="small ${alert.severity === 'overdue' ? 'warn' : ''}">
                  ${dateShort(alert.date)}
                  <div class="muted">${relativeDays(alert.date)}</div></td>
                <td><a class="clamp-2" href="${alert.href}">${alert.title}</a>
                    <div class="row-meta show-sm">
                      ${badge(KIND_LABELS[alert.kind], SEVERITY_TONES[alert.severity])}
                      <span class="muted">${alert.detail}</span>
                    </div></td>
                <td class="col-sm-hide">${badge(KIND_LABELS[alert.kind], SEVERITY_TONES[alert.severity])}</td>
                <td class="small muted col-sm-hide">${alert.detail}</td>
              </tr>`), { sticky: true, fixed: true, empty: 'Nothing due in this window.' })}
        </div>`);
    });

    app.route('/alerts', r);
  },
};
