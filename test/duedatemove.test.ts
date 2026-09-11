/**
 * A new date is not a new status.
 *
 * **Reported on 11 September 2026:** *"i just received an extension from INZ of
 * time to file an australian PC for a client in CASE-26-050 - and I need to
 * record that - Due Date Extended - and enter the new date - but I cannot."*
 *
 * The practice reached for a new status, and asked whether the status list
 * could be editable like the other dropdowns. The answer is no, and the reason
 * is worth keeping: a status is not a label. Fifteen of them drive behaviour —
 * which matters count as open, which carry a deadline that must not be missed,
 * which are with INZ and so raise the no-acknowledgement alert, and which set
 * `decided_at` of their own accord. A sixteenth added from a settings page
 * would belong to none of those lists and would be invisible to every alert.
 *
 * But the matter had not changed state. It was Decision pending before the
 * extension and Decision pending after it. Only the date moved — and the date
 * was locked behind the status, because "Move to" was required. The only way to
 * record an extension was to pretend the matter had moved somewhere it had not.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CASE_STATUSES, DEADLINE_CASE_STATUSES, OPEN_CASE_STATUSES, isAwaitingStatus,
} from '../src/domain';

const src = readFileSync('src/modules/cases/index.ts', 'utf8');

describe('why the status list is not a vocabulary', () => {
  it('drives which matters count as open', () => {
    expect(OPEN_CASE_STATUSES.length).toBeGreaterThan(0);
    for (const s of OPEN_CASE_STATUSES) expect(CASE_STATUSES).toContain(s);
  });

  it('drives which matters carry a deadline', () => {
    expect(DEADLINE_CASE_STATUSES).toEqual(['ppi', 'ipt_appeal', 'reconsideration']);
  });

  it('drives which matters are waiting for a date at all', () => {
    expect(isAwaitingStatus('decision_pending')).toBe(true);
    expect(isAwaitingStatus('approved')).toBe(false);
  });

  it('is a fixed list in the code, not a setting', () => {
    // A status invented in a settings page would belong to none of the lists
    // above, so no alert would ever see it.
    const domain = readFileSync('src/domain.ts', 'utf8');
    expect(domain).toContain('export const CASE_STATUSES = [');
    expect(domain).toContain('] as const;');
  });
});

describe('the date can move without the status', () => {
  it('no longer demands a status', () => {
    expect(src).toContain("const status = f.enum('status', CASE_STATUSES, { label: 'Status' });");
    expect(src).not.toContain(
      "f.enum('status', CASE_STATUSES, { required: true, label: 'Status' })");
  });

  it('offers to leave the status alone', () => {
    expect(src).toContain("includeBlank: 'Leave as it is'");
    expect(src).not.toContain("required: true, includeBlank: 'Choose a status'");
  });

  it('writes only the date, and says the status is unchanged', () => {
    expect(src).toContain("'UPDATE cases SET decision_due_at = ?, updated_at = ? WHERE id = ?'");
    expect(src).toContain('The status is unchanged.');
  });

  it('records the move on the file rather than in the status history', () => {
    // A history of statuses that records something else stops being a history
    // of statuses.
    const branch = src.slice(src.indexOf('if (!status) {'), src.indexOf('The status is unchanged.'));
    expect(branch).toContain('Response or decision due:');
    expect(branch).not.toContain('case_status_history');
  });

  it('audits it under its own action', () => {
    expect(src).toContain("action: 'case.decision_due_changed'");
  });

  it('moves the INZ chases with it', () => {
    // They hang off this date. Leaving them where they were would chase a date
    // that no longer exists.
    const branch = src.slice(src.indexOf('if (!status) {'), src.indexOf('The status is unchanged.'));
    expect(branch).toContain('syncCaseFollowUps');
  });

  it('refuses a date on a matter that is waiting for nothing', () => {
    expect(src).toContain('is not waiting for anything, so ');
  });

  it('still asks for one or the other when given neither', () => {
    expect(src).toContain('Choose a status, or give a new date for the response or decision.');
  });
});
