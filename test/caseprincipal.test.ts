/**
 * The person the matter is for appears on the matter.
 *
 * Asked for on 9 September 2026, looking at a partnership matter whose Parties
 * panel listed two dependent children and a supporting partner and nobody for
 * them to be dependent on or supporting: *"i see the principal applicant is
 * noted in the right side, but i would love to see them in the main screen as
 * well - under Parties - just above the secondary applicants"*.
 *
 * Shown, not stored. `cases.client_id` remains the one owner of who the client
 * is; writing a second copy into `case_parties` would be two records of one
 * fact, free to disagree. So the test asserts what the page shows, and asserts
 * the other half too — that a client who *does* have a party row is listed
 * once, under their recorded role, not twice.
 */

import { describe, expect, it } from 'vitest';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';

const AT = '2026-09-09T00:00:00Z';
const USER = fakeUser({ id: 'u_pa', email: 'pa@example.test' });

function seeded() {
  const h = mountModule(casesModule, { user: USER });
  h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
    .run(USER.id, USER.email, USER.name, AT, AT);
  const client = (id: string, ref: string, name: string, kind = 'individual') =>
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(id, ref, kind, name, AT, AT);
  client('c1', 'CL-9001', 'A Applicant');
  client('c2', 'CL-9002', 'A Child');
  h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, priority,
                                   assigned_to, created_at, updated_at)
                VALUES ('k1','CASE-26-001','c1','A matter','wv_aewv','preparing','normal',?,?,?)`)
    .run(USER.id, AT, AT);
  const party = (id: string, clientId: string, role: string) =>
    h.db.prepare(`INSERT INTO case_parties (id, case_id, client_id, role, created_at)
                  VALUES (?, 'k1', ?, ?, ?)`).run(id, clientId, role, AT);
  return { h, client, party };
}

/** The Parties card only, so a name in Key details cannot pass for a name here. */
async function partiesPanel(h: ReturnType<typeof seeded>['h']) {
  const body = await (await h.request('/cases/k1')).text();
  const i = body.indexOf('party-list');
  expect(i, 'the parties list is on the page').toBeGreaterThan(-1);
  return body.slice(i, body.indexOf('</ul>', i));
}

describe('the Parties panel on a matter', () => {
  it('lists the client even when they have no party row', async () => {
    const { h, party } = seeded();
    party('p1', 'c2', 'dependent_child');
    const panel = await partiesPanel(h);
    expect(panel).toContain('A Applicant');
    expect(panel).toContain('CL-9001');
  });

  it('puts the client above the other parties', async () => {
    const { h, party } = seeded();
    party('p1', 'c2', 'dependent_child');
    const panel = await partiesPanel(h);
    expect(panel.indexOf('A Applicant')).toBeLessThan(panel.indexOf('A Child'));
  });

  it('lists the client on a matter with nobody else on it', async () => {
    const { h } = seeded();
    expect(await partiesPanel(h)).toContain('A Applicant');
  });

  it('notes that the client is the principal applicant', async () => {
    const { h, party } = seeded();
    party('p1', 'c2', 'dependent_child');
    expect(await partiesPanel(h)).toContain('Principal applicant');
  });

  it('does not list the client twice when they do have a party row', async () => {
    // Their recorded role is the truth, so the row stands and nothing is added.
    const { h, party } = seeded();
    party('p1', 'c1', 'principal_applicant');
    const panel = await partiesPanel(h);
    expect(panel.split('CL-9001').length - 1).toBe(1);
    expect(panel).toContain('Principal applicant');
  });

  it('offers no way to take the client off their own matter', async () => {
    const { h, party } = seeded();
    party('p1', 'c2', 'dependent_child');
    const panel = await partiesPanel(h);
    // One remove button, and it belongs to the child.
    expect(panel.split('/parties/').length - 1).toBe(1);
    expect(panel).toContain('/parties/p1/remove');
  });
});
