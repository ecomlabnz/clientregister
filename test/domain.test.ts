import { describe, expect, it } from 'vitest';
import { dateOrDateTime, dateShort, instantForDate } from '../src/ui/format';
import {
  CASE_STATUSES, CASE_STATUS_HELP, CASE_STATUS_LABELS, CASE_TRANSITIONS, canTransition, isCaseStatus, isOpenStatus, OPEN_CASE_STATUSES,
} from '../src/domain';

describe('case status lifecycle', () => {
  it('labels and explains every status', () => {
    for (const status of CASE_STATUSES) {
      expect(CASE_STATUS_LABELS[status]).toBeTruthy();
      expect(CASE_STATUS_HELP[status]).toBeTruthy();
      expect(CASE_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('only ever transitions to a real status', () => {
    for (const [from, targets] of Object.entries(CASE_TRANSITIONS)) {
      for (const to of targets) {
        expect(isCaseStatus(to), `${from} -> ${to}`).toBe(true);
        expect(to).not.toBe(from);
      }
    }
  });

  it('allows the ordinary path through a lodged application', () => {
    expect(canTransition('lead', 'engaged')).toBe(true);
    expect(canTransition('engaged', 'gathering_documents')).toBe(true);
    expect(canTransition('gathering_documents', 'ready_to_lodge')).toBe(true);
    expect(canTransition('ready_to_lodge', 'lodged')).toBe(true);
    expect(canTransition('lodged', 'ppi')).toBe(true);
    expect(canTransition('ppi', 'decision_pending')).toBe(true);
    expect(canTransition('decision_pending', 'approved')).toBe(true);
    expect(canTransition('approved', 'closed')).toBe(true);
  });

  it('refuses to jump straight from a lead to an outcome', () => {
    expect(canTransition('lead', 'approved')).toBe(false);
    expect(canTransition('lead', 'lodged')).toBe(false);
    expect(canTransition('engaged', 'declined')).toBe(false);
  });

  it('lets a declined case go to the Tribunal or back to INZ, but not back to lodgement', () => {
    expect(canTransition('declined', 'ipt_appeal')).toBe(true);
    expect(canTransition('declined', 'reconsideration')).toBe(true);
    expect(canTransition('declined', 'lodged')).toBe(false);
  });

  it('treats a same-status update as allowed, and unknown statuses as not', () => {
    expect(canTransition('lodged', 'lodged')).toBe(true);
    expect(canTransition('lodged', 'teleported')).toBe(false);
    expect(canTransition('imaginary', 'lodged')).toBe(false);
  });

  it('can park any live case and resume it to any status', () => {
    for (const status of OPEN_CASE_STATUSES) {
      if (status === 'on_hold') continue;
      expect(canTransition(status, 'on_hold'), `${status} -> on_hold`).toBe(true);
    }
    for (const status of CASE_STATUSES) {
      if (status === 'on_hold') continue;
      expect(canTransition('on_hold', status), `on_hold -> ${status}`).toBe(true);
    }
    // A withdrawn matter is finished, not paused.
    expect(canTransition('withdrawn', 'on_hold')).toBe(false);
  });

  it('counts live work as open and finished work as not', () => {
    expect(OPEN_CASE_STATUSES.every(isOpenStatus)).toBe(true);
    for (const status of ['approved', 'declined', 'closed', 'withdrawn']) {
      expect(isOpenStatus(status), status).toBe(false);
    }
  });
});

describe('storing a date somebody typed', () => {
  it('lands on that calendar date in New Zealand, not the day after', () => {
    // Midday UTC would be the small hours of the following morning here, and a
    // note backdated to Thursday would appear on the file as Friday.
    expect(instantForDate('2026-08-20')).toBe('2026-08-20T00:00:00.000Z');
    expect(dateShort(instantForDate('2026-08-20'))).toBe('20 Aug 2026');
    // Both New Zealand offsets: standard time in August, daylight time in January.
    expect(dateShort(instantForDate('2027-01-15'))).toBe('15 Jan 2027');
    expect(dateShort(instantForDate('2026-12-31'))).toBe('31 Dec 2026');
  });

  it('shows a date on its own when no real time was recorded', () => {
    expect(dateOrDateTime(instantForDate('2026-08-20'))).toBe('20 Aug 2026');
    expect(dateOrDateTime('2026-08-20T03:45:00.000Z')).toContain(':');
  });
});

/**
 * Compliance is a state a file is in, not a kind of work.
 *
 * Asked for by the practice on 1 September 2026, on a matter whose entire file
 * was an audio recording of a voluntary INZ Investigations interview. The
 * extraction had invented a case *type* for it; the practice's answer was that
 * what INZ is doing there is not work the practice takes on — it is something
 * that happens to a file, and the file can be in that state whatever the
 * application underneath it was.
 */
describe('a matter under investigation', () => {
  it('is a status the register knows', () => {
    expect(isCaseStatus('inz_investigation')).toBe(true);
    expect(CASE_STATUS_LABELS.inz_investigation).toBe('Under INZ investigation');
    expect(CASE_STATUS_HELP.inz_investigation).toBeTruthy();
  });

  it('counts as live work', () => {
    // A file INZ is asking questions about is the opposite of finished.
    expect(isOpenStatus('inz_investigation')).toBe(true);
    expect(OPEN_CASE_STATUSES).toContain('inz_investigation');
  });

  it('can be entered from anywhere the file is still live', () => {
    // An investigation does not wait for a convenient moment.
    for (const from of ['engaged', 'gathering_documents', 'preparing', 'lodged', 'ppi', 'approved'] as const) {
      expect(canTransition(from, 'inz_investigation'), `from ${from}`).toBe(true);
    }
  });

  it('leads back to everywhere the file was going', () => {
    // It interrupts an application; it does not replace it.
    for (const to of ['lodged', 'approved', 'declined', 'withdrawn', 'closed'] as const) {
      expect(canTransition('inz_investigation', to), `to ${to}`).toBe(true);
    }
  });

  it('is not a decided status', () => {
    // Nothing has been decided. It must not be mistaken for an outcome.
    expect(CASE_STATUS_LABELS.inz_investigation).not.toMatch(/approved|declined|granted/i);
  });
});
