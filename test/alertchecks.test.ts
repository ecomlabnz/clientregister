import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { KIND_LABELS_FOR_TEST } from '../src/modules/alerts';

const alerts = readFileSync('src/modules/alerts/index.ts', 'utf8');

/**
 * Two things a date cannot tell you.
 *
 * Every other alert answers "what is due". These answer "what is wrong", which
 * is how matters actually go astray: not by a missed deadline, but by a file
 * nobody has touched, or one whose own record contradicts itself.
 */
describe('alerts that are not about a date', () => {
  it('names both kinds', () => {
    expect(KIND_LABELS_FOR_TEST.quiet).toBe('Gone quiet');
    expect(KIND_LABELS_FOR_TEST.contradiction).toBe('Does not add up');
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
