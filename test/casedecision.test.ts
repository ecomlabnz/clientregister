/**
 * What a matter records when a decision arrives, and what it stops asking for.
 *
 * Three things went wrong together on a real file (CASE-26-051, approved on
 * 31 August 2026):
 *
 *  - The status form offered "Response / decision due" on every move, decided
 *    statuses included. Approving a matter and typing the approval date into
 *    it is the obvious reading of a box that is there, and it is the wrong
 *    field — that date means something still awaited.
 *  - The date the decision actually arrived *was* recorded, automatically, but
 *    only shown further down the page, so it looked as though nothing had been.
 *  - The line beside the Approved badge read "Granted." — the same word again,
 *    where every other status uses that line to say what to do next.
 *
 * The rules pinned here are the first two. The third is pinned generally: no
 * status may explain itself with its own label.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';
import { CASE_STATUS_HELP, CASE_STATUS_LABELS, CASE_STATUSES } from '../src/domain';

const AT = '2026-08-31T00:00:00Z';
const USER = fakeUser();

function seed(h: any, status = 'lodged', decisionDue: string | null = null) {
  h.db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?)`,
  ).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  h.db.prepare(
    `INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
     VALUES ('CL1', 'CL-0001', 'individual', 'A CLIENT', 'active', ?, ?)`,
  ).run(AT, AT);
  h.db.prepare(
    `INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                        lodged_at, decision_due_at, created_at, updated_at)
     VALUES ('K1', 'CASE-26-001', 'CL1', 'A matter', 'wv_aewv', ?, ?, '2026-08-04', ?, ?, ?)`,
  ).run(status, USER.id, decisionDue, AT, AT);
}

const mount = () => mountModule(casesModule, { user: USER });
const caseRow = (h: any) => h.get('SELECT * FROM cases WHERE id = ?', 'K1');

describe('the date a decision arrived', () => {
  it('is recorded by the register, without being asked for', async () => {
    const h = mount();
    seed(h);
    await h.post('/cases/K1/status', { status: 'approved' });

    const k = caseRow(h);
    expect(k.status).toBe('approved');
    expect(k.decided_at).toBeTruthy();
    expect(k.outcome).toBe('approved');
  });

  it('is shown beside the status, not only further down the page', async () => {
    const h = mount();
    seed(h);
    await h.post('/cases/K1/status', { status: 'approved' });

    const body = await (await h.request('/cases/K1')).text();
    // The badge and the date sit in the same line, so "when was this granted"
    // is answered where the answer is looked for.
    const line = /<p class="status-now">[\s\S]*?<\/p>/.exec(body)?.[0] ?? '';
    expect(line).toContain('Approved');
    expect(line).toMatch(/\d{1,2}\s+\w+\s+2026/);
  });
});

describe('the response / decision due field', () => {
  it('is not offered on a matter that is waiting for nothing', async () => {
    const h = mount();
    seed(h);
    await h.post('/cases/K1/status', { status: 'approved' });

    const body = await (await h.request('/cases/K1')).text();
    // From Approved the only moves are Closed and On hold, neither of which
    // waits on INZ, so the box that invited the mistake is simply not there.
    expect(body).not.toContain('name="decision_due_at"');
  });

  it('is offered while something is still awaited', async () => {
    const h = mount();
    seed(h);
    const body = await (await h.request('/cases/K1')).text();
    expect(body).toContain('name="decision_due_at"');
  });

  it('is ignored when the matter is being decided', async () => {
    const h = mount();
    seed(h);
    // The mistake as it was actually made: the approval's own date typed into
    // the deadline box while moving to Approved.
    await h.post('/cases/K1/status', { status: 'approved', decision_due_at: '2026-08-31' });

    const k = caseRow(h);
    expect(k.decision_due_at).toBeNull();
    // And the date it was really after is recorded, so nothing was lost.
    expect(k.decided_at).toBeTruthy();
  });

  it('is taken when the matter is still waiting', async () => {
    const h = mount();
    seed(h);
    await h.post('/cases/K1/status', { status: 'inz_rfi', decision_due_at: '2026-09-20' });
    expect(caseRow(h).decision_due_at).toBe('2026-09-20');
  });

  it('keeps a date already recorded when a decision arrives', async () => {
    // Never trade a record for tidiness: an expected date beside the date the
    // decision actually came is how the practice sees what INZ took.
    const h = mount();
    seed(h, 'lodged', '2026-08-28');
    await h.post('/cases/K1/status', { status: 'approved' });
    expect(caseRow(h).decision_due_at).toBe('2026-08-28');
  });
});

describe('the line beside a status badge', () => {
  it('never just repeats the badge', () => {
    // "Approved / Granted." was two words for one fact. The line exists to say
    // what the badge cannot.
    for (const status of CASE_STATUSES) {
      const label = CASE_STATUS_LABELS[status].toLowerCase().replace(/[^a-z ]/g, '').trim();
      const help = CASE_STATUS_HELP[status].toLowerCase().replace(/[^a-z ]/g, '').trim();
      expect(help).not.toBe(label);
      // Nor a bare synonym: a line worth reading says more than one word.
      expect(help.split(/\s+/).length).toBeGreaterThan(2);
    }
  });
});
