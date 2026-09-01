/**
 * What a matter records when a decision arrives, and what it stops asking for.
 *
 * Three things went wrong together on one real matter, found in the register on
 * 31 August 2026:
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
import {
  AWAITING_CASE_STATUSES, canTransition, CASE_STATUS_HELP, CASE_STATUS_LABELS,
  CASE_STATUSES, CASE_TRANSITIONS,
} from '../src/domain';
import { AWAITING_DECISION_STATUSES } from '../src/core/decisions';

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
    await h.post('/cases/K1/status', { status: 'ppi', decision_due_at: '2026-09-20' });
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

describe('the status list the practice reads', () => {
  /**
   * Two changes the practice asked for on 31 August 2026, after reading the
   * dropdown back and finding it asked questions it should not.
   *
   * "INZ — further information requested" and "PPI letter received" described
   * one working state — a letter from INZ with a clock on it — so the register
   * was making somebody choose between two words for one thing. One status
   * now, named for both.
   *
   * "Appeal / reconsideration" was the opposite fault: two places with two
   * clocks under one name, so the list could not answer "who is holding this
   * file". The Tribunal and INZ are now separate statuses.
   */
  it('has one status for a letter from INZ with a clock on it', () => {
    expect(CASE_STATUSES).not.toContain('inz_rfi');
    expect(CASE_STATUSES).toContain('ppi');
    expect(CASE_STATUS_LABELS.ppi).toBe('PPI / RFI letter received');
  });

  it('separates the Tribunal from asking INZ again', () => {
    expect(CASE_STATUSES).not.toContain('appeal');
    expect(CASE_STATUSES).toContain('ipt_appeal');
    expect(CASE_STATUSES).toContain('reconsideration');
    // Both are routes out of a refusal, and both can end in a grant.
    expect(canTransition('declined', 'ipt_appeal')).toBe(true);
    expect(canTransition('declined', 'reconsideration')).toBe(true);
    expect(canTransition('ipt_appeal', 'approved')).toBe(true);
    expect(canTransition('reconsideration', 'approved')).toBe(true);
  });

  it('keeps every remaining status reachable, so none is a dead letter', () => {
    // A status nothing can move to is a status nobody can ever set.
    const reachable = new Set(Object.values(CASE_TRANSITIONS).flat());
    for (const s of CASE_STATUSES) {
      if (s === 'lead') continue;  // where a matter starts
      expect(reachable.has(s), `${s} is unreachable`).toBe(true);
    }
  });

  it('still treats both appeal routes as waiting on somebody else', () => {
    expect(AWAITING_CASE_STATUSES).toContain('ipt_appeal');
    expect(AWAITING_CASE_STATUSES).toContain('reconsideration');
    // But neither is chased as if INZ were sitting on it.
    expect(AWAITING_DECISION_STATUSES).not.toContain('ipt_appeal');
  });
});

describe('filtering the case list by what kind of matter it is', () => {
  /**
   * This exists because the filter shipped broken in its first draft and no
   * test noticed: the placeholder was asked for before the parameter was
   * pushed, so it numbered one slot back and the filter matched nothing.
   * `tsc` was clean, the page rendered, the dropdown worked — the only
   * symptom was an empty list, which looks exactly like "no matters of that
   * type".
   *
   * So the test asserts what a filter is for: it returns the rows of that
   * type, and not the others. An off-by-one in the binding fails it.
   */
  function seedTypes(h: any) {
    seed(h);
    h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                     created_at, updated_at)
                  VALUES ('K2','CASE-26-002','CL1','Another','vv_general','lodged',?,?,?)`)
      .run(USER.id, AT, AT);
    h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                     created_at, updated_at)
                  VALUES ('K3','CASE-26-003','CL1','A third','vv_general','lodged',?,?,?)`)
      .run(USER.id, AT, AT);
  }
  const refsOn = (body: string) => [...body.matchAll(/CASE-26-\d{3}/g)].map((m) => m[0]);

  it('returns the matters of that type and no others', async () => {
    const h = mount();
    seedTypes(h);
    // K1 is wv_aewv; K2 and K3 are vv_general.
    const body = await (await h.request('/cases?scope=all&type=vv_general')).text();
    const refs = new Set(refsOn(body));
    expect(refs.has('CASE-26-002')).toBe(true);
    expect(refs.has('CASE-26-003')).toBe(true);
    expect(refs.has('CASE-26-001')).toBe(false);
  });

  it('shows everything when no type is asked for', async () => {
    const h = mount();
    seedTypes(h);
    const refs = new Set(refsOn(await (await h.request('/cases?scope=all')).text()));
    expect(refs.size).toBe(3);
  });

  it('ignores a type nobody offers rather than emptying the list', async () => {
    // A stale bookmark or a typed address should degrade to "unfiltered",
    // not to a list that silently looks empty.
    const h = mount();
    seedTypes(h);
    const refs = new Set(refsOn(await (await h.request('/cases?scope=all&type=not_a_type')).text()));
    expect(refs.size).toBe(3);
  });
});

describe('what the case list shows, and what it keeps back', () => {
  /**
   * The practice read the list back on 31 August 2026 and found two columns
   * saying what other columns already said: the matter title was the client's
   * name and the type again, and a Decision column had to print "decided" on
   * every row to explain a date the status badge beside it already accounted
   * for.
   *
   * Both became preferences rather than deletions, and both went off. Later
   * the same day the cause of the first was fixed rather than hidden: a matter
   * is now named by what it is about, so the Matter column carries the one
   * thing no other column says and is on again. The Decision column stays off.
   *
   * What is pinned here is that each switch works on its own, and that the
   * description is on the row either way — under the reference when the column
   * is off, in the column when it is on, and never in both places at once.
   */
  const withPrefs = async (h: any, prefs: Record<string, string>) => {
    for (const [key, value] of Object.entries(prefs)) {
      h.db.prepare(`INSERT INTO user_preferences (user_id, key, value, updated_at)
                    VALUES (?, ?, ?, ?)`).run(USER.id, key, value, AT);
    }
  };
  const headings = (body: string) =>
    [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      // The sort arrow is inside the th, so strip it — left in, every
      // `toContain` here would pass for the wrong reason and every
      // `not.toContain` would pass vacuously.
      .map((m) => m[1]!.replace(/<[^>]*>/g, '').replace(/[↕↑↓]/g, '').trim())
      .filter(Boolean);

  /** One matter whose name and description differ, so the two can be told
      apart on the page. */
  const seedNamed = (h: any) => {
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
                  VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                  VALUES ('CL1','CL-0001','individual','A CLIENT','active',?,?)`).run(AT, AT);
    h.db.prepare(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,
                                     assigned_to,created_at,updated_at)
                  VALUES ('K1','CASE-26-001','CL1','A title','Knife hand, Southland',
                          'wv_aewv','lodged',?,?,?)`).run(USER.id, AT, AT);
  };

  it('opens with the Matter column in and the Decision column out', async () => {
    const h = mount();
    seed(h);
    const heads = headings(await (await h.request('/cases?scope=all')).text());
    expect(heads).toContain('Matter');
    expect(heads).not.toContain('Decision');
    expect(heads).toContain('Client');
    expect(heads).toContain('Type');
  });

  it('turns each one on its own', async () => {
    // Two switches, not one: asking for the Decision column must not drop the
    // Matter column, and turning the Matter column off must not bring the
    // Decision column in.
    const on = mount();
    seed(on);
    await withPrefs(on, { 'pref.cases_show_decision': 'true' });
    const withDecision = headings(await (await on.request('/cases?scope=all')).text());
    expect(withDecision).toContain('Decision');
    expect(withDecision).toContain('Matter');

    const off = mount();
    seed(off);
    await withPrefs(off, { 'pref.cases_show_matter': 'false' });
    const withoutMatter = headings(await (await off.request('/cases?scope=all')).text());
    expect(withoutMatter).not.toContain('Matter');
    expect(withoutMatter).not.toContain('Decision');
  });

  it('keeps the row description when the Matter column is off', async () => {
    // The column goes; what the matter is *about* must not go with it.
    const h = mount();
    seedNamed(h);
    await withPrefs(h, { 'pref.cases_show_matter': 'false' });
    const body = await (await h.request('/cases?scope=all')).text();
    expect(body).toContain('Knife hand, Southland');
    expect(body).toContain('CASE-26-001');
  });

  it('says what the matter is about once, not twice, when the column is on', async () => {
    // The column and the line under the reference were both on the row for a
    // few hours, printing the same sentence twice. That is what made the
    // column look redundant in the first place.
    const h = mount();
    seedNamed(h);
    const row = (await (await h.request('/cases?scope=all')).text())
      .match(/<tbody>[\s\S]*?<\/tbody>/)![0];
    expect(row).toContain('A title');
    expect(row.match(/Knife hand, Southland/g) ?? []).toHaveLength(0);
  });

  it('puts a decision date under the badge only when a decision was made', async () => {
    // A matter can carry a decided_at from an earlier life — reopened, or
    // imported — and a bare date under "Lodged with INZ" reads as a decision
    // that has not happened.
    const h = mount();
    seed(h);
    h.db.prepare(`UPDATE cases SET decided_at = '2026-01-01' WHERE id = 'K1'`).run();
    const stillLodged = await (await h.request('/cases?scope=all')).text();
    expect(stillLodged).not.toContain('01 Jan 2026');

    await h.post('/cases/K1/status', { status: 'approved' });
    const decided = await (await h.request('/cases?scope=all')).text();
    expect(decided).toContain('01 Jan 2026');
  });

  it('offers Clear only when something is filtered', async () => {
    const h = mount();
    seed(h);
    expect(await (await h.request('/cases?scope=all')).text()).not.toContain('>Clear</a>');
    expect(await (await h.request('/cases?scope=all&status=lodged')).text()).toContain('>Clear</a>');
  });
});
