import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { KIND_LABELS_FOR_TEST } from '../src/modules/alerts';

const alerts = readFileSync('src/modules/alerts/index.ts', 'utf8');

/**
 * The things a date cannot tell you.
 *
 * Every other alert answers "what is due". These answer "what is wrong", which
 * is how matters actually go astray: not by a missed deadline, but by a file
 * nobody has touched, one whose own record contradicts itself, a lodgement
 * never acknowledged, a task with no room in front of it, or a person whose
 * immigration status the register never learned.
 *
 * These are the guards on how the checks are wired. Whether each one fires on
 * the right record is proved in `test/alertsql.test.ts`, against a database
 * built from the migrations.
 */
describe('alerts that are not about a date', () => {
  it('names every kind', () => {
    expect(KIND_LABELS_FOR_TEST.quiet).toBe('Gone quiet');
    expect(KIND_LABELS_FOR_TEST.contradiction).toBe('Does not add up');
    expect(KIND_LABELS_FOR_TEST.unacknowledged).toBe('Not acknowledged');
    expect(KIND_LABELS_FOR_TEST.no_slack).toBe('No room to act');
    expect(KIND_LABELS_FOR_TEST.status_unknown).toBe('Status not recorded');
  });

  it('reads the acknowledgement grace period once, where the alerts are built', () => {
    // Same reasoning as the quiet threshold: three pages call collectAlerts.
    expect(alerts).toContain("key: 'alerts.ack_days'");
    expect(alerts).toContain("d.key === 'alerts.ack_days'");
    expect(alerts).not.toMatch(/collectAlerts\([^)]*ackDays/);
  });

  it('never asks an organisation for a visa it cannot hold', () => {
    // A row that can never be cleared teaches people to ignore the list.
    expect(alerts).toContain("cl.kind = 'individual'");
  });

  it('sends the missing-status row to the person, not the matter', () => {
    // The visa is recorded on the client. A row that exists to be cleared has
    // to land where clearing it happens.
    const block = alerts.slice(alerts.indexOf("kind: 'status_unknown' as const"));
    expect(block.slice(0, 900)).toContain('`/clients/${k.client_id}`');
  });

  it('stays deterministic — no model is consulted', () => {
    // The argument for putting these beside the dates is that they are as
    // checkable as a date is. A row somebody has to investigate before acting
    // is a row they learn to skip, and it costs the reliable rows their
    // credibility too.
    expect(alerts).not.toMatch(/getProvider|briefCase|ai\//);
  });

  it('judges silence by how long it has run, not by a due date', () => {
    // There is no due date on a quiet file. That is the entire point of it.
    expect(alerts).toContain("daysBetween(on, today) >= quietDays * 2 ? 'overdue' : 'urgent'");
  });

  it('treats a contradiction as pressing but never as late', () => {
    // It is not late, it is wrong, and a record that contradicts itself cannot
    // be relied on until somebody looks.
    const block = alerts.slice(alerts.indexOf("kind: 'contradiction' as const"));
    expect(block).toContain("severity: 'urgent' as AlertSeverity");
  });

  it('says which facts disagree, not merely that something does', () => {
    expect(alerts).toContain('function describeContradiction');
    for (const phrase of ['but lodged', 'with no decision date', 'is in the future']) {
      expect(alerts, `no wording for: ${phrase}`).toContain(phrase);
    }
  });

  it('reads the quiet threshold once, where the alerts are built', () => {
    // Three pages call collectAlerts. A threshold meaning one thing on the
    // dashboard and another on the alerts page would be a bug nobody sees.
    expect(alerts).toContain("key: 'alerts.quiet_days'");
    expect(alerts).toContain("d.key === 'alerts.quiet_days'");
    expect(alerts).not.toMatch(/collectAlerts\([^)]*quietDays/);
  });

  it('counts an open matter as touched by a note, a status change or a task', () => {
    // Any of the three is somebody working on it. Only the case row's own
    // created_at is the fallback, for a matter nothing has ever happened on.
    const q = alerts.slice(alerts.indexOf('AS last_touched') - 900, alerts.indexOf('AS last_touched'));
    expect(q).toContain('FROM entries e');
    expect(q).toContain('FROM case_status_history h');
    expect(q).toContain('FROM tasks t');
    expect(q).toContain('k.created_at');
  });
});
