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
import { CASE_STATUS_LABELS, DEADLINE_CASE_STATUSES, LODGED_CASE_STATUSES, OPEN_CASE_STATUSES } from '../../domain';
import { pendingProposalCount } from '../../core/automations';

export type AlertKind =
  | 'case_deadline' | 'task' | 'document' | 'quote'
  /** An open matter nothing has happened on for a while. */
  | 'quiet'
  /** A matter whose own recorded facts disagree with each other. */
  | 'contradiction'
  /** Mail is set up and the poll is running, but nothing has arrived. */
  | 'mail_quiet'
  /** Work finished and nothing was ever charged for it. */
  | 'unbilled'
  /** Lodged with INZ, but no application number was ever written down. */
  | 'unacknowledged'
  /** A task that leaves no working time before the deadline it serves. */
  | 'no_slack'
  /** An open matter for someone whose immigration status is not recorded. */
  | 'status_unknown'
  /** A visa whose expiry waits on an event that has not happened yet. */
  | 'expiry_unfixed';
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

/**
 * Whether an alert's `date` is a deadline or a provenance.
 *
 * The two are not comparable, and treating them as one field sorted by date is
 * what put a 2024 lodgement at the top of "Needs you today" above a reply due
 * this afternoon. The practice said so on 3 September: *"there are some old
 * ones for closed cases — yes they need to be attended to but the priority is
 * so low."*
 *
 *   - **`due`** — the date is when the thing must be done. A visa expiry, a
 *     decision deadline, a task. Older means more overdue, so oldest first is
 *     right, and being old is exactly what makes it urgent.
 *   - **`wrong`** — the date is only *when the record was made*. A matter that
 *     says approved with no decision date has been wrong since it was lodged;
 *     that lodgement date says nothing about how pressing it is. These are
 *     real work and must not be hidden, but they do not compete with today.
 *
 * So: everything `due` first, oldest first; everything `wrong` after it,
 * newest first — because a record that went wrong yesterday is likelier to be
 * a live mistake than one that has been wrong for two years.
 */
export function alertTiming(kind: AlertKind): 'due' | 'wrong' {
  switch (kind) {
    case 'case_deadline': case 'task': case 'document': case 'quote': case 'no_slack':
    // The date is the day the work finished. The longer ago that was, the
    // likelier the money is to be forgotten — so it sorts like a deadline,
    // oldest first, rather than like a record that is merely wrong.
    case 'unbilled':
      return 'due';
    default:
      return 'wrong';
  }
}

/**
 * The order a working morning wants: what is late or due today, then what is
 * merely wrong. Exported so the dashboard and the alerts page cannot drift into
 * two different ideas of what "first" means.
 */
export function byWorkingOrder(a: Alert, b: Alert): number {
  const at = alertTiming(a.kind);
  const bt = alertTiming(b.kind);
  if (at !== bt) return at === 'due' ? -1 : 1;
  return at === 'due' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
}

const KIND_LABELS: Record<AlertKind, string> = {
  case_deadline: 'Case deadline',
  task: 'Task',
  document: 'Document expiry',
  quote: 'Quote expiry',
  quiet: 'Gone quiet',
  contradiction: 'Does not add up',
  mail_quiet: 'No mail arriving',
  unbilled: 'Nothing charged',
  unacknowledged: 'Not acknowledged',
  no_slack: 'No room to act',
  status_unknown: 'Status not recorded',
  expiry_unfixed: 'Expiry not yet fixed',
};

/** Exposed for the tests, which check that every kind is named. */
export const KIND_LABELS_FOR_TEST = KIND_LABELS;

const SEVERITY_TONES: Record<AlertSeverity, 'red' | 'amber' | 'neutral'> = {
  overdue: 'red', urgent: 'amber', soon: 'neutral',
};

const URGENT_DAYS = 14;

/**
 * How loud a row should be.
 *
 * `urgentDays` is how far ahead counts as pressing. It defaults to the
 * register-wide fourteen, and is raised for the things you cannot do on the
 * day — a medical needs an appointment, an overseas police certificate can take
 * months — because a warning that arrives too late to act on is not a warning.
 */
function severityFor(date: string, today: string, urgentDays = URGENT_DAYS): AlertSeverity {
  if (date < today) return 'overdue';
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  return days <= urgentDays ? 'urgent' : 'soon';
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
  // A certificate is not like a deadline. You cannot do it on the day: a
  // replacement medical needs an appointment, and a police certificate from
  // overseas can take longer than the notice period itself. So certificates get
  // their own, longer, "this is pressing now" window.
  const noticeDays = Number(
    await settingValue(env,
      ALERT_SETTINGS.settings.find((d) => d.key === 'alerts.certificate_notice_days')!),
  ) || 30;

  // The certificate arms also ask whether the issue date behind the cached
  // expiry was ever read off the certificate itself (0040). MIN() because two
  // certificates can share the cached expiry date: the worst provenance among
  // them is the honest one to report, and 'from_filename' < 'unverified' <
  // 'verified' happens to sort exactly that way.
  const rows = await all<{
    id: string; ref: string; full_name: string; document: string; expires: string;
    provenance: string | null;
  }>(
    env.DB,
    `SELECT c.id, c.ref, c.full_name,
            'Passport' || CASE WHEN p.country IS NULL THEN '' ELSE ' (' || p.country || ')' END AS document,
            p.expires_on AS expires, NULL AS provenance
       FROM client_passports p JOIN clients c ON c.id = p.client_id
      WHERE p.status = 'held' AND p.expires_on IS NOT NULL AND p.expires_on <= ?1
        AND c.status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Current visa', current_visa_expiry, NULL FROM clients
       WHERE current_visa_expiry IS NOT NULL AND current_visa_expiry <= ?1 AND status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Police certificate', police_certificate_expiry,
            (SELECT MIN(cc.issued_on_provenance) FROM client_certificates cc
              WHERE cc.client_id = clients.id AND cc.kind = 'police'
                AND cc.expires_on = clients.police_certificate_expiry)
       FROM clients
       WHERE police_certificate_expiry IS NOT NULL AND police_certificate_expiry <= ?1 AND status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Medical certificate', medical_certificate_expiry,
            (SELECT MIN(cc.issued_on_provenance) FROM client_certificates cc
              WHERE cc.client_id = clients.id AND cc.kind = 'medical'
                AND cc.expires_on = clients.medical_certificate_expiry)
       FROM clients
       WHERE medical_certificate_expiry IS NOT NULL AND medical_certificate_expiry <= ?1 AND status != 'archived'
     UNION ALL
     SELECT id, ref, full_name, 'Chest x-ray', chest_xray_expiry, NULL FROM clients
       WHERE chest_xray_expiry IS NOT NULL AND chest_xray_expiry <= ?1 AND status != 'archived'
     ORDER BY expires
     LIMIT 200`,
    horizon,
  );

  return rows.map((row) => ({
    kind: 'document' as const,
    severity: severityFor(row.expires, today, noticeDays),
    date: row.expires,
    title: `${row.document} — ${row.full_name}`,
    // A deadline computed from a date nobody confirmed says so in the row
    // itself, not on a page somebody would have to think to open.
    detail: row.provenance && row.provenance !== 'verified'
      ? `${row.ref} · worked out from an issue date never confirmed against the certificate`
      : row.ref,
    href: `/clients/${row.id}`,
  }));
}

/**
 * The checks that are not about a date.
 *
 * Every other alert answers "what is due". These answer "what is wrong", which
 * is how matters actually go astray — rarely to a missed deadline, usually to
 * nobody looking. Each is a plain query: certain, checkable at a glance, and
 * free. No model is consulted, which is the whole argument for putting them
 * beside the dates rather than in a queue of suggestions.
 *
 * They are named and exported so the suite can run them against a database
 * built from the migrations, with a row that should fire and a row that should
 * not. A check nobody has watched fire is a check nobody knows the meaning of.
 *
 * Each takes the placeholder list for the statuses it filters on, because the
 * status lists live in `src/domain.ts` and must not be spelled out twice.
 */
export const CHECKS_NOT_ABOUT_A_DATE = {
  /**
   * An open matter with no note, no status change and no task activity for a
   * while. Any of the three counts as somebody working on it; only the case
   * row's own created_at is the fallback, for a matter nothing has ever
   * happened on.
   */
  quiet: (openIn: string) => `SELECT k.id, k.ref, k.title, k.descriptor, k.status, cl.full_name AS client_name,
              MAX(COALESCE(
                (SELECT MAX(e.occurred_at) FROM entries e
                  WHERE e.entity_type = 'case' AND e.entity_id = k.id), ''),
                COALESCE((SELECT MAX(h.at) FROM case_status_history h WHERE h.case_id = k.id), ''),
                COALESCE((SELECT MAX(t.updated_at) FROM tasks t
                           WHERE t.entity_type = 'case' AND t.entity_id = k.id), ''),
                k.created_at) AS last_touched
         FROM cases k JOIN clients cl ON cl.id = k.client_id
        WHERE k.status IN (${openIn})
        GROUP BY k.id
       HAVING SUBSTR(last_touched, 1, 10) <= ?
        ORDER BY last_touched LIMIT 100`,

  /**
   * A matter whose own recorded facts disagree with each other: decided before
   * it was lodged, marked approved or declined with no decision date, lodged on
   * a date that has not arrived.
   */
  contradiction: () => `SELECT k.id, k.ref, k.title, k.status, cl.full_name AS client_name,
              k.lodged_at, k.decided_at, k.updated_at,
              (SELECT MIN(h.at) FROM case_status_history h
                WHERE h.case_id = k.id AND h.to_status = 'lodged') AS history_lodged
         FROM cases k JOIN clients cl ON cl.id = k.client_id
        WHERE (k.decided_at IS NOT NULL AND k.lodged_at IS NOT NULL AND k.decided_at < k.lodged_at)
           OR (k.status IN ('approved','declined') AND k.decided_at IS NULL)
           OR (k.lodged_at IS NOT NULL AND SUBSTR(k.lodged_at, 1, 10) > ?)
        ORDER BY k.ref LIMIT 100`,

  /**
   * Lodged with INZ, and no application number on the file.
   *
   * INZ acknowledges a lodgement by issuing that number. After the grace
   * period its absence means one of two things — the acknowledgement never
   * arrived, or it arrived and nobody wrote it down — and you find out which by
   * looking. Either way the matter cannot be quoted, chased or checked online
   * until the number is there.
   *
   * The lodgement date is derived, so the filter on it sits outside the
   * subquery: a bare HAVING with no GROUP BY would make SQLite treat the whole
   * result as one aggregate group and hand back a single row.
   */
  unacknowledged: (lodgedIn: string) => `SELECT * FROM (
         SELECT k.id, k.ref, k.title, k.descriptor, k.status, cl.full_name AS client_name,
                COALESCE(k.lodged_at,
                  (SELECT MIN(h.at) FROM case_status_history h
                    WHERE h.case_id = k.id AND h.to_status = 'lodged')) AS lodged_on
           FROM cases k JOIN clients cl ON cl.id = k.client_id
          WHERE k.status IN (${lodgedIn})
            AND COALESCE(TRIM(k.inz_application_number), '') = ''
       )
        WHERE lodged_on IS NOT NULL AND SUBSTR(lodged_on, 1, 10) <= ?
        ORDER BY lodged_on LIMIT 100`,

  /**
   * A task due on the same day as the deadline it serves.
   *
   * "Draft the RFI response", due on the day the response is due, is not a
   * plan — it is the deadline written twice. There is no room in it for the
   * client to be unreachable, for a document to be missing, or for the day to
   * go wrong. The register cannot know how long the work takes; it can see that
   * nothing at all was allowed for it.
   *
   * Only while there is still time to move it. Once the day has passed, the
   * deadline row says the same thing, louder.
   */
  noSlack: (openIn: string) => `SELECT t.id, t.title, t.due_at, t.entity_id, u.name AS assignee_name,
              k.ref, k.title AS case_title, k.status,
              COALESCE(k.decision_due_at, k.next_action_due) AS deadline
         FROM tasks t
         JOIN cases k ON k.id = t.entity_id AND t.entity_type = 'case'
         LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.status IN ('open','in_progress','blocked')
          AND t.due_at IS NOT NULL
          AND k.status IN (${openIn})
          AND SUBSTR(t.due_at, 1, 10) = SUBSTR(COALESCE(k.decision_due_at, k.next_action_due), 1, 10)
          AND SUBSTR(t.due_at, 1, 10) >= ?
        ORDER BY t.due_at LIMIT 100`,

  /**
   * An open matter for someone whose immigration status is not recorded.
   *
   * Every question a matter turns on — what they may apply for, whether they
   * are lawful, what happens on a refusal — starts from the visa they hold now.
   * A blank here is not a small gap; it is the file not knowing the one fact
   * everything else is measured against. It clears by recording the answer, and
   * "none, offshore" is an answer.
   *
   * Individuals only. An organisation does not hold a visa, and a row that can
   * never be cleared teaches people to ignore the list.
   */
  statusUnknown: (openIn: string) => `SELECT k.id, k.ref, k.title, k.descriptor, k.status, k.decision_due_at, k.created_at,
              cl.id AS client_id, cl.full_name AS client_name, cl.ref AS client_ref
         FROM cases k JOIN clients cl ON cl.id = k.client_id
        WHERE k.status IN (${openIn})
          AND cl.kind = 'individual'
          AND COALESCE(TRIM(cl.current_visa_type), '') = ''
        ORDER BY k.ref LIMIT 100`,

  /**
   * A visa whose expiry is a rule waiting on an event — "24 months after
   * first arrival" — with no date fixed yet (0041). Left as a blank this
   * would be indistinguishable from "never recorded" and nothing would
   * watch it; the row exists so somebody asks whether the event has
   * happened, and clears the moment the date is written down.
   */
  expiryUnfixed: () => `SELECT id, ref, full_name, current_visa_expiry_rule, updated_at
         FROM clients
        WHERE current_visa_expiry IS NULL
          AND COALESCE(TRIM(current_visa_expiry_rule), '') != ''
          AND status != 'archived'
        ORDER BY ref LIMIT 100`,
};

/**
 * Mail is configured, the poll is running, and nothing is arriving.
 *
 * This is the one check that fires on an **absence**, and it exists because an
 * absence was invisible. On 3 September the practice's domain had no SPF record,
 * so Gmail refused every message forwarded into the polled mailbox and the
 * register's Incoming quietly thinned out. Nothing in the register looked wrong:
 * an empty inbox is exactly what a quiet week looks like. It was found only when
 * a sender showed the practice the bounce.
 *
 * Three things have to be true together, and the third is what makes it a
 * finding rather than a guess:
 *
 *   1. Mail is set up at all — no alert on a register that does not poll.
 *   2. The poll is **alive**, having run within the hour. Without this the alert
 *      would fire on a worker that is simply not running, which is a different
 *      fault with a different fix, and saying the wrong one wastes an hour.
 *   3. Nothing has been captured for longer than the practice's threshold.
 *
 * Poll alive + nothing arriving is the signature of the delivery path being
 * broken upstream: forwarding, authentication, a filter. That is what to look
 * at, and the alert says so.
 */
async function mailQuietAlert(env: Env, today: string): Promise<Alert[]> {
  const quietDays = Number(
    await settingValue(env, ALERT_SETTINGS.settings.find((d) => d.key === 'alerts.mail_quiet_days')!),
  ) || 3;
  if (quietDays <= 0) return [];

  const rows = await all<{ key: string; value: string }>(
    env.DB,
    `SELECT key, value FROM settings
      WHERE key IN ('ingest.last_poll_at', 'ingest.last_capture_at')`);
  const at = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  const lastPoll = at('ingest.last_poll_at');
  const lastCapture = at('ingest.last_capture_at');

  // Never polled: mail is not set up, or has never run. Not this alert's
  // business — there is nothing to say "has stopped" about.
  if (!lastPoll) return [];

  // The poll itself is not running. A different fault, and the register cannot
  // tell from here whether mail is arriving, so it says nothing rather than
  // pointing at the wrong thing.
  const pollAgeMinutes = (Date.parse(`${today}T23:59:59Z`) - Date.parse(lastPoll)) / 60_000;
  if (!Number.isFinite(pollAgeMinutes) || pollAgeMinutes > 24 * 60) return [];

  const since = lastCapture ? lastCapture.slice(0, 10) : null;
  if (since && daysBetween(since, today) < quietDays) return [];
  if (!since) return [];

  const quietFor = daysBetween(since, today);
  return [{
    kind: 'mail_quiet',
    // Louder the longer it runs. Post that is not arriving is post the practice
    // does not know it is missing.
    severity: quietFor >= quietDays * 2 ? 'overdue' : 'urgent',
    date: since,
    title: 'No mail has arrived',
    detail: `The mailbox has been checked as usual, but nothing has come in for `
      + `${quietFor} days — last on ${dateShort(since)}. The checking is working, so `
      + `look at what happens before it: forwarding from the practice address, and the `
      + `domain's SPF, DKIM and DMARC records. See docs/email-setup.md.`,
    href: '/admin/maintenance',
  }];
}

/**
 * Work finished, and nothing was ever charged for it.
 *
 * The practice asked for this on 3 September: *"do not want to miss payments
 * for work done."*
 *
 * **The window is what makes it usable.** Counted against production the day it
 * was written: 135 finished matters have no fee, no invoice and no agreed fee
 * — because the register was loaded from an archive of matters the practice had
 * already dealt with, and because fees are entered by hand rather than derived.
 * An alert firing 135 times on the first morning is not an alert; it is a
 * screen nobody reads again. Two settings narrow it to work that is plausibly
 * still collectable:
 *
 *   - **How far back to look.** Ninety days by default. Older than that and it
 *     is the archive, not a forgotten invoice.
 *   - **How long to leave it.** A fortnight by default. A matter decided
 *     yesterday has not been forgotten; it has not been billed *yet*, and
 *     nagging on the day is how a person learns to ignore the page.
 *
 * With those two, the same production data yields six — which is a morning's
 * work rather than a wall.
 *
 * "Charged for" is read broadly on purpose: a fee line, an invoice, or an
 * agreed fee on the matter all count. The practice records money in more than
 * one place and this is asking whether the money was *dealt with*, not whether
 * a particular row exists.
 */
export function unbilledWindow(
  today: string, lookBackDays: number, graceDays: number,
): { from: string; until: string } {
  // Two ends, and they are not symmetrical. `from` is how far back the archive
  // stops being interesting; `until` is how recently a matter finished for it
  // still to be somebody's in-tray rather than a forgotten invoice. Extracted
  // so both can be tested: the first version of these tests passed the dates
  // in, and so proved nothing about the arithmetic that produces them —
  // removing the grace period entirely did not fail a single one.
  return {
    from: shiftDays(today, -Math.max(0, lookBackDays)),
    until: shiftDays(today, -Math.max(0, graceDays)),
  };
}

async function unbilledAlerts(env: Env, today: string): Promise<Alert[]> {
  const lookBack = Number(await settingValue(
    env, ALERT_SETTINGS.settings.find((d) => d.key === 'alerts.unbilled_days')!)) || 0;
  if (lookBack <= 0) return [];
  const grace = Number(await settingValue(
    env, ALERT_SETTINGS.settings.find((d) => d.key === 'alerts.unbilled_grace_days')!)) || 0;

  const { from, until } = unbilledWindow(today, lookBack, grace);

  const rows = await all<any>(
    env.DB,
    `SELECT k.id, k.ref, k.title, k.descriptor, k.status, cl.full_name AS client_name,
            substr(COALESCE(k.decided_at, k.closed_at, k.updated_at), 1, 10) AS done_on
       FROM cases k JOIN clients cl ON cl.id = k.client_id
      WHERE (k.status IN ('approved','declined','withdrawn','closed') OR k.closed_at IS NOT NULL)
        AND substr(COALESCE(k.decided_at, k.closed_at, k.updated_at), 1, 10) BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM fee_items fi WHERE fi.case_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.case_id = k.id)
        AND COALESCE(k.fee_agreed_cents, 0) = 0
      ORDER BY done_on LIMIT 100`,
    from, until);

  return rows.map((k: any) => ({
    kind: 'unbilled' as const,
    // Louder the longer it has sat. Not "overdue" on the day the grace period
    // ends — it is a prompt, not a deadline somebody has missed.
    severity: (daysBetween(String(k.done_on), today) >= grace * 3 ? 'overdue' : 'urgent') as AlertSeverity,
    date: String(k.done_on),
    title: k.title,
    detail: `${k.descriptor ? `${k.descriptor} · ` : ''}${k.client_name} · ${k.ref} · `
      + `finished ${dateShort(String(k.done_on))}, nothing charged`,
    href: `/cases/${k.id}`,
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
  const ackDays = Number(
    await settingValue(env, ALERT_SETTINGS.settings.find((d) => d.key === 'alerts.ack_days')!),
  ) || 14;
  const openPlaceholders = OPEN_CASE_STATUSES.map(() => '?').join(',');
  const lodgedPlaceholders = LODGED_CASE_STATUSES.map(() => '?').join(',');

  const [cases, tasks, quotes, documents, quiet, contradictions,
         unacknowledged, noSlack, statusUnknown, expiryUnfixed] = await Promise.all([
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

    // The checks that are not about a date. See CHECKS_NOT_ABOUT_A_DATE.
    all<any>(env.DB, CHECKS_NOT_ABOUT_A_DATE.quiet(openPlaceholders),
      ...OPEN_CASE_STATUSES, shiftDays(today, -quietDays)),
    all<any>(env.DB, CHECKS_NOT_ABOUT_A_DATE.contradiction(), today),
    all<any>(env.DB, CHECKS_NOT_ABOUT_A_DATE.unacknowledged(lodgedPlaceholders),
      ...LODGED_CASE_STATUSES, shiftDays(today, -ackDays)),
    all<any>(env.DB, CHECKS_NOT_ABOUT_A_DATE.noSlack(openPlaceholders),
      ...OPEN_CASE_STATUSES, today),
    all<any>(env.DB, CHECKS_NOT_ABOUT_A_DATE.statusUnknown(openPlaceholders),
      ...OPEN_CASE_STATUSES),
    all<any>(env.DB, CHECKS_NOT_ABOUT_A_DATE.expiryUnfixed()),
  ]);

  // Fired on an absence rather than on a row, so it is assembled rather than
  // queried, and it is the last thing collected because it depends on nothing
  // above it.
  const mailQuiet = await mailQuietAlert(env, today);
  const unbilled = await unbilledAlerts(env, today);

  const alerts: Alert[] = [
    ...mailQuiet,
    ...unbilled,
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
      // To the task, which is the thing the row is about; the task page links
      // on to whatever it is attached to.
      href: `/tasks/${t.id}`,
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
    ...unacknowledged.map((k: any) => {
      const on = String(k.lodged_on).slice(0, 10);
      return {
        kind: 'unacknowledged' as const,
        // Measured from the lodgement, not from a due date — there is none.
        // Twice the grace period without a number is no longer an oversight.
        severity: (daysBetween(on, today) >= ackDays * 2 ? 'overdue' : 'urgent') as AlertSeverity,
        date: on,
        title: k.title,
        detail: `${k.descriptor ? `${k.descriptor} · ` : ''}${k.client_name} · ${k.ref} · `
          + `lodged ${dateShort(on)}, no INZ application number recorded`,
        href: `/cases/${k.id}`,
      };
    }),
    ...noSlack.map((t: any) => ({
      kind: 'no_slack' as const,
      severity: severityFor(String(t.due_at).slice(0, 10), today),
      date: String(t.due_at).slice(0, 10),
      title: t.title,
      detail: `${t.case_title} · ${t.ref} · due the same day as the deadline it serves`
        + `${t.assignee_name ? ` · ${t.assignee_name}` : ''}`,
      href: `/tasks/${t.id}`,
    })),
    ...statusUnknown.map((k: any) => ({
      kind: 'status_unknown' as const,
      // Pressing once the file is with INZ or about to be: from there on the
      // answer cannot be checked without asking the client, and it is the fact
      // every other question on the matter is measured against.
      severity: ((LODGED_CASE_STATUSES as string[]).includes(k.status) || k.status === 'ready_to_lodge'
        ? 'urgent' : 'soon') as AlertSeverity,
      date: String(k.decision_due_at ?? k.created_at ?? today).slice(0, 10),
      title: k.title,
      detail: `${k.descriptor ? `${k.descriptor} · ` : ''}${k.client_name} · ${k.client_ref} · `
        + 'no current visa recorded',
      // To the client, not the matter: the visa is recorded on the person, and
      // the row exists to be cleared.
      href: `/clients/${k.client_id}`,
    })),
    ...expiryUnfixed.map((cl: any) => ({
      kind: 'expiry_unfixed' as const,
      // Always pressing, never overdue: there is no date to be late against —
      // that is the problem the row states. It clears when the date is fixed.
      severity: 'urgent' as AlertSeverity,
      date: String(cl.updated_at ?? today).slice(0, 10),
      title: `Visa expiry not yet fixed — ${cl.full_name}`,
      detail: `${cl.ref} · ${cl.current_visa_expiry_rule} · record the date once the event has happened`,
      href: `/clients/${cl.id}`,
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
    { key: 'alerts.unbilled_days', type: 'enum',
      label: 'Look for unbilled work finished in the last',
      default: '90',
      // Offered as a list rather than a free number, at the practice's request:
      // the useful settings are a handful of round periods, and a box that
      // accepts 37 invites a decision nobody wanted to make.
      options: [
        { value: '0', label: 'Off \u2014 do not look' },
        { value: '30', label: '30 days' },
        { value: '60', label: '60 days' },
        { value: '90', label: '90 days' },
        { value: '120', label: '120 days' },
        { value: '150', label: '150 days' },
        { value: '200', label: '200 days' },
        { value: '365', label: 'A year' },
      ],
      help: 'Matters that finished without a fee, an invoice or an agreed fee. Older than this '
        + 'is treated as history rather than a missed payment \u2014 the register holds an '
        + 'archive of matters already dealt with, and without a window this would name every '
        + 'one of them. Widen it as the fees on file get more complete.' },
    { key: 'alerts.unbilled_grace_days', type: 'integer',
      label: 'Leave unbilled work alone for (days)',
      default: '14', min: 0, max: 120,
      help: 'How long after a matter finishes before it is worth mentioning. A matter decided '
        + 'yesterday has not been forgotten, and being nagged on the day is how a page stops '
        + 'being read.' },
    { key: 'alerts.mail_quiet_days', type: 'integer',
      label: 'Warn when no mail has arrived for (days)',
      default: '3', min: 1, max: 60,
      help: 'The register checks the mailbox every few minutes. If the checking is working but '
        + 'nothing has come in for this many days, something before it is probably broken — '
        + 'forwarding, or the domain\u2019s mail records. Set to the longest quiet spell that '
        + 'would not worry you.' },
    { key: 'alerts.certificate_notice_days', type: 'integer',
      label: 'Warn about an expiring certificate (days ahead)',
      default: '30', min: 7, max: 180,
      help: 'A police certificate, medical or x-ray inside this window counts as pressing '
        + 'rather than upcoming. Replacing one takes weeks — a police certificate from '
        + 'overseas can take longer than that — so the warning has to come while there is '
        + 'still time to act on it.' },
    { key: 'alerts.ack_days', type: 'integer', label: 'Expect an INZ acknowledgement within (days)',
      default: '14', min: 1, max: 180,
      help: 'A lodged matter with no INZ application number recorded after this long is '
        + 'listed under \u201cNot acknowledged\u201d. Either the acknowledgement never came, '
        + 'or it came and nobody wrote the number down \u2014 and both are worth knowing '
        + 'before you need to quote it.' },
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
