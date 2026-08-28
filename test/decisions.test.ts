import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AWAITING_DECISION_STATUSES, DECISION_SETTINGS, expectedDecisionDate, parseSchedule,
} from '../src/core/decisions';

const migration = readFileSync('migrations/0019_decision_followups.sql', 'utf8');

describe('when a decision is expected', () => {
  it('counts months forward from lodgement', () => {
    expect(expectedDecisionDate('2026-08-20', 1)).toBe('2026-09-20');
    expect(expectedDecisionDate('2026-08-20', 3)).toBe('2026-11-20');
  });

  it('gives nothing for a matter that has not been lodged', () => {
    // Inventing one would put a deadline on the alerts page that nothing in
    // the world is working towards.
    expect(expectedDecisionDate(null, 1)).toBeNull();
  });

  it('handles a month that has no such day', () => {
    // 31 January plus one month is not 31 February.
    expect(expectedDecisionDate('2026-01-31', 1)).toBe('2026-03-03');
  });

  it('takes a full ISO timestamp as readily as a date', () => {
    expect(expectedDecisionDate('2026-08-20T09:15:00.000Z', 1)).toBe('2026-09-20');
  });
});

describe('the chase schedule is what somebody typed, made safe', () => {
  it('reads a plain list', () => {
    expect(parseSchedule('0, 1, 2')).toEqual([0, 1, 2]);
    expect(parseSchedule('1 2 3')).toEqual([1, 2, 3]);
  });

  it('sorts and de-duplicates, so one day gets one task', () => {
    expect(parseSchedule('2,1,1,0')).toEqual([0, 1, 2]);
  });

  it('drops anything that is not a sensible number of months', () => {
    expect(parseSchedule('1, later, -3, 99, 2')).toEqual([1, 2]);
  });

  it('falls back rather than leaving a matter unchased on a typo', () => {
    expect(parseSchedule('')).toEqual([0, 1, 2]);
    expect(parseSchedule('nonsense')).toEqual([0, 1, 2]);
    expect(parseSchedule(undefined)).toEqual([0, 1, 2]);
  });

  it('caps how many chases one matter can raise', () => {
    expect(parseSchedule('1,2,3,4,5,6,7,8,9,10,11,12,13,14').length).toBe(12);
  });
});

describe('only a matter actually waiting on INZ is chased', () => {
  it('lists the statuses that mean "with them, waiting"', () => {
    expect(AWAITING_DECISION_STATUSES).toEqual(
      ['lodged', 'inz_rfi', 'ppi', 'interim_visa', 'decision_pending']);
  });

  it('excludes everything decided, withdrawn or not yet lodged', () => {
    for (const status of ['approved', 'declined', 'closed', 'withdrawn', 'lead', 'preparing']) {
      expect(AWAITING_DECISION_STATUSES, status).not.toContain(status);
    }
  });
});

describe('the schedule is adjustable rather than baked in', () => {
  it('offers every part of it as a setting', () => {
    const keys = DECISION_SETTINGS.settings.map((s) => s.key);
    expect(keys).toContain('cases.expected_decision_months');
    expect(keys).toContain('cases.chase_enabled');
    expect(keys).toContain('cases.chase_schedule');
    expect(keys).toContain('cases.chase_priority');
  });

  it('defaults to a month, then chases on the day and monthly twice more', () => {
    const byKey = (k: string) => DECISION_SETTINGS.settings.find((s) => s.key === k)!;
    expect(byKey('cases.expected_decision_months').default).toBe('1');
    expect(parseSchedule(byKey('cases.chase_schedule').default)).toEqual([0, 1, 2]);
  });

  it('lets one matter opt out without changing the practice default', () => {
    expect(migration).toContain('ALTER TABLE cases ADD COLUMN chase_inz');
  });
});

describe('a chase is a position in a sequence, not a date', () => {
  it('keys the row on the case and which chase it is', () => {
    // Keyed on the date instead, moving the expected decision would leave the
    // old task behind and raise a second one for the same chase.
    expect(migration).toContain('PRIMARY KEY (case_id, sequence)');
  });

  it('goes when its case goes', () => {
    expect(migration).toContain('REFERENCES cases(id) ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES tasks(id) ON DELETE CASCADE');
  });
});
