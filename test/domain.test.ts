import { describe, expect, it } from 'vitest';
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
    expect(canTransition('lodged', 'inz_rfi')).toBe(true);
    expect(canTransition('inz_rfi', 'decision_pending')).toBe(true);
    expect(canTransition('decision_pending', 'approved')).toBe(true);
    expect(canTransition('approved', 'closed')).toBe(true);
  });

  it('refuses to jump straight from a lead to an outcome', () => {
    expect(canTransition('lead', 'approved')).toBe(false);
    expect(canTransition('lead', 'lodged')).toBe(false);
    expect(canTransition('engaged', 'declined')).toBe(false);
  });

  it('lets a declined case go to appeal but not back to lodgement', () => {
    expect(canTransition('declined', 'appeal')).toBe(true);
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
