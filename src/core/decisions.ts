/**
 * The expected decision date, and chasing INZ when it passes.
 *
 * Two settings and one schedule. A decision is expected a configurable number
 * of months after lodgement — a month, by default — and the date is filled in
 * automatically when a matter is lodged without one, because a date nobody
 * typed is still a date the alerts page can watch. It stays editable: INZ
 * publishes processing times per visa type, and the adviser handling the matter
 * knows better than a default does.
 *
 * When that date passes, a task is raised to follow it up. Then again a month
 * later, and again the month after — as many chases as the schedule names.
 *
 * The whole thing is reconciled rather than fired. Every chase is a row keyed
 * to its case and its position in the sequence, rebuilt against the current
 * dates on each pass, so moving the expected decision date moves the chases
 * with it and changing the schedule corrects every open matter overnight. A
 * chase somebody has already done, or decided not to do, is left alone: the
 * point is to prompt a person, not to argue with one.
 */

import type { Env } from '../types';
import type { SettingsGroup } from './settings';
import { all, nowIso, one, run } from './db';
import { newId } from './ids';
import { readSettings } from './settings';
import { addMonths } from './kb';
import { LODGED_CASE_STATUSES } from '../domain';

/**
 * Statuses that mean "with INZ, waiting". A matter that has been decided,
 * withdrawn or closed is not chased, and one still being prepared has not been
 * lodged to chase about.
 *
 * Derived from `LODGED_CASE_STATUSES` rather than retyped, because two
 * hand-maintained copies of the same list are two lists that will one day
 * disagree and nobody will notice which is right.
 *
 * `appeal` is deliberately *not* here, and that is the one real difference
 * from `AWAITING_CASE_STATUSES` in `domain.ts`: a matter under appeal is with
 * the Tribunal, and the practice does not chase INZ about it. That set governs
 * whether a response date may be recorded; this one governs whether the
 * register chases for it.
 */
export const AWAITING_DECISION_STATUSES: string[] = [...LODGED_CASE_STATUSES];

export interface DecisionPolicy {
  /** Months after lodgement at which a decision is expected. */
  expectedMonths: number;
  chaseEnabled: boolean;
  /**
   * Months *after the expected decision date* at which to chase. 0 chases on
   * the day it was expected. Anchored on the expected date rather than on
   * lodgement so that changing how long a decision takes moves the chases too,
   * instead of chasing before the decision is even due.
   */
  chaseOffsets: number[];
  chasePriority: string;
}

export const DECISION_SETTINGS: SettingsGroup = {
  id: 'decisions',
  title: 'Decisions and chasing INZ',
  description: 'When a decision is expected after lodgement, and what happens when that date passes.',
  order: 25,
  settings: [
    { key: 'cases.expected_decision_months', type: 'integer', label: 'A decision is expected after (months)',
      default: '1', min: 0, max: 24,
      help: 'Filled in automatically when a matter is lodged without an expected decision date. '
        + 'Always editable on the matter itself — this is a starting point, not a rule.' },
    { key: 'cases.chase_enabled', type: 'boolean', label: 'Raise a task when a decision is overdue',
      default: 'true',
      help: 'Assigned to whoever owns the matter. Turn it off for one matter on the matter itself.' },
    { key: 'cases.chase_schedule', type: 'string', label: 'Chase when the decision is overdue by (months)',
      default: '0, 1, 2', maxLength: 60,
      help: 'Counted from the expected decision date, so 0 chases on the day it was expected. '
        + 'With a one-month expectation, “0, 1, 2” chases one, two and three months after '
        + 'lodgement. Up to twelve, separated by commas.' },
    { key: 'cases.chase_priority', type: 'enum', label: 'Priority of a chase',
      default: 'normal',
      options: [
        { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' },
        { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
      ] },
  ],
};

/**
 * Parse the schedule a person typed.
 *
 * Deliberately forgiving about separators and deliberately strict about the
 * result: sorted, de-duplicated, whole months, at most twelve. A schedule of
 * "1,1,1" is one chase, not three tasks on one day.
 */
export function parseSchedule(raw: string | undefined, fallback = [0, 1, 2]): number[] {
  if (raw === undefined || raw === null) return fallback;
  const parts = String(raw).split(/[,;\s]+/).filter(Boolean);
  const months: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || value < 0 || value > 36) continue;
    const month = Math.round(value);
    if (!months.includes(month)) months.push(month);
  }
  months.sort((a, b) => a - b);
  return months.length ? months.slice(0, 12) : fallback;
}

export async function decisionPolicy(env: Env): Promise<DecisionPolicy> {
  const values = await readSettings(env, DECISION_SETTINGS.settings);
  const months = Number(values['cases.expected_decision_months']);
  return {
    expectedMonths: Number.isFinite(months) ? Math.max(0, Math.min(24, months)) : 1,
    chaseEnabled: values['cases.chase_enabled'] !== 'false',
    chaseOffsets: parseSchedule(values['cases.chase_schedule']),
    chasePriority: values['cases.chase_priority'] || 'normal',
  };
}

/**
 * The date a decision is expected, for a matter lodged on `lodgedOn`.
 *
 * Returns null when there is nothing to count from — an unlodged matter has no
 * expected decision, and inventing one would put a deadline on the alerts page
 * that nothing in the world is working towards.
 */
export function expectedDecisionDate(lodgedOn: string | null, months: number): string | null {
  if (!lodgedOn) return null;
  return addMonths(lodgedOn.slice(0, 10), Math.max(0, Math.round(months)));
}

interface CaseDates {
  id: string;
  ref: string;
  title: string;
  status: string;
  decision_due_at: string | null;
  chase_inz: number;
  assigned_to: string | null;
  created_by: string | null;
}

/** Whoever the chase should go to. A task is never unassigned. */
async function chaseAssignee(env: Env, ...candidates: Array<string | null>): Promise<string | null> {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const row = await one<{ id: string }>(
      env.DB, `SELECT id FROM users WHERE id = ? AND status = 'active'`, candidate);
    if (row) return row.id;
  }
  const fallback = await one<{ id: string }>(
    env.DB, `SELECT id FROM users WHERE status = 'active' ORDER BY
               CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 1`);
  return fallback?.id ?? null;
}

export interface SyncResult { created: number; moved: number; cancelled: number }

/** Reconcile the chases on one matter against its dates. */
export async function syncCaseFollowUps(
  env: Env, matter: CaseDates, policy?: DecisionPolicy,
): Promise<SyncResult> {
  const rules = policy ?? (await decisionPolicy(env));
  const now = nowIso();
  const today = now.slice(0, 10);
  const result: SyncResult = { created: 0, moved: 0, cancelled: 0 };

  const existing = new Map<number, { task_id: string; due_on: string; task_status: string }>(
    (await all<{ sequence: number; task_id: string; due_on: string; task_status: string }>(
      env.DB,
      `SELECT f.sequence, f.task_id, f.due_on, t.status AS task_status
         FROM case_followups f JOIN tasks t ON t.id = f.task_id
        WHERE f.case_id = ?`,
      matter.id,
    )).map((row) => [row.sequence, row]),
  );

  const live = rules.chaseEnabled
    && matter.chase_inz === 1
    && Boolean(matter.decision_due_at)
    && AWAITING_DECISION_STATUSES.includes(matter.status);

  const wanted = live
    ? rules.chaseOffsets.map((offset, i) => ({
        sequence: i + 1,
        // Never behind today: a chase whose date has already gone by is work
        // for now, not something backdated out of sight.
        due: (() => {
          const date = addMonths(matter.decision_due_at!, offset);
          return date < today ? today : date;
        })(),
        offset,
      }))
    : [];

  // Anything the schedule no longer asks for is withdrawn rather than left
  // sitting in somebody's list with no reason behind it.
  for (const [sequence, current] of existing) {
    if (wanted.some((w) => w.sequence === sequence)) continue;
    if (current.task_status === 'open' || current.task_status === 'in_progress') {
      await run(env.DB, `UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?`, now, current.task_id);
      result.cancelled += 1;
    }
    await run(env.DB, `DELETE FROM case_followups WHERE case_id = ? AND sequence = ?`, matter.id, sequence);
  }

  if (!live) return result;

  const assignee = await chaseAssignee(env, matter.assigned_to, matter.created_by);
  if (!assignee) return result;

  for (const chase of wanted) {
    const current = existing.get(chase.sequence);
    const title = chase.offset === 0
      ? `Chase INZ — ${matter.ref} decision due ${matter.decision_due_at}`
      : `Chase INZ — ${matter.ref} decision ${chase.offset} ${chase.offset === 1 ? 'month' : 'months'} overdue`;

    if (!current) {
      const taskId = newId('tsk');
      await run(
        env.DB,
        `INSERT INTO tasks (id, title, details, status, priority, due_at, assigned_to,
                            entity_type, entity_id, created_at, updated_at, created_by)
         VALUES (?,?,?, 'open', ?,?,?, 'case', ?,?,?,?)`,
        taskId, title,
        `Raised automatically: a decision on “${matter.title}” was expected by `
          + `${matter.decision_due_at}. Ring or write to INZ and record what they say on the file.`,
        rules.chasePriority, chase.due, assignee, matter.id, now, now, null,
      );
      await run(
        env.DB,
        `INSERT INTO case_followups (case_id, sequence, task_id, due_on, created_at) VALUES (?,?,?,?,?)`,
        matter.id, chase.sequence, taskId, chase.due, now,
      );
      result.created += 1;
      continue;
    }

    // Somebody who has done or dismissed a chase has answered it.
    if (current.task_status === 'done' || current.task_status === 'cancelled') continue;

    if (current.due_on !== chase.due) {
      await run(env.DB, `UPDATE tasks SET title = ?, due_at = ?, updated_at = ? WHERE id = ?`,
        title, chase.due, now, current.task_id);
      await run(env.DB, `UPDATE case_followups SET due_on = ? WHERE case_id = ? AND sequence = ?`,
        chase.due, matter.id, chase.sequence);
      result.moved += 1;
    }
  }

  return result;
}

/**
 * Reconcile every matter that could be waiting on a decision.
 *
 * Run nightly. This is what makes the schedule genuinely adjustable: change it
 * in settings and every open matter is on the new timing by morning, rather
 * than only the ones somebody happens to edit afterwards.
 */
export async function syncAllCaseFollowUps(env: Env): Promise<SyncResult> {
  const policy = await decisionPolicy(env);
  const placeholders = AWAITING_DECISION_STATUSES.map(() => '?').join(',');
  const matters = await all<CaseDates>(
    env.DB,
    `SELECT id, ref, title, status, decision_due_at, chase_inz, assigned_to, created_by
       FROM cases
      WHERE status IN (${placeholders}) OR id IN (SELECT case_id FROM case_followups)`,
    ...AWAITING_DECISION_STATUSES,
  );

  const total: SyncResult = { created: 0, moved: 0, cancelled: 0 };
  for (const matter of matters) {
    const result = await syncCaseFollowUps(env, matter, policy);
    total.created += result.created;
    total.moved += result.moved;
    total.cancelled += result.cancelled;
  }
  return total;
}

/** One matter, read for reconciliation. */
export async function caseForSync(env: Env, caseId: string): Promise<CaseDates | null> {
  return one<CaseDates>(
    env.DB,
    `SELECT id, ref, title, status, decision_due_at, chase_inz, assigned_to, created_by
       FROM cases WHERE id = ?`,
    caseId,
  );
}
