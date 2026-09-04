/**
 * A matter that says it was decided carries the date it was decided.
 *
 * The practice entered a matter that had already been granted and asked why the
 * file said "Decided —" beside a status of Approved: *"the Decided is empty —
 * despite the current status of the case"*. Both had been written by the same
 * form press, and they disagreed.
 *
 * The rule existed, in the status-change handler. What it did not cover was a
 * matter *created* at a decided status — a granted case entered after the fact,
 * which is a normal thing to do — and there was no field anywhere through which
 * a person could write the date either. Nine matters in the live register are in
 * that state.
 *
 * So the database keeps the rule now, and the tests attack the database
 * directly rather than going through a route: the whole point is that it holds
 * whatever writes the row.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { mountModule, fakeUser } from './support/d1';
import { casesModule } from '../src/modules/cases';
import { decisionLine, elapsedLine, isDecidedStatus } from '../src/modules/cases';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-04T00:00:00Z';
const USER = fakeUser({ id: 'u_dec', email: 'dec@example.test' });

function register() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
  const open = (id: string, status: string, decided: string | null = null) =>
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   decided_at, created_at, updated_at)
                VALUES (?, ?, 'c1', 'A matter', 'wv_aewv', ?, 'u1', ?, ?, ?)`)
      .run(id, `CASE-26-${id}`, status, decided, AT, AT);
  const read = (id: string) =>
    (db.prepare('SELECT status, decided_at FROM cases WHERE id = ?') as any).get(id) as
      { status: string; decided_at: string | null };
  return { db, open, read };
}

describe('the database keeps the decision date, whatever writes the row', () => {
  it('stamps a matter created already approved', () => {
    const { open, read } = register();
    open('k1', 'approved');
    expect(read('k1').decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('stamps a matter created already declined', () => {
    const { open, read } = register();
    open('k2', 'declined');
    expect(read('k2').decided_at).not.toBeNull();
  });

  it('stamps one that reaches a decision by an update', () => {
    const { db, open, read } = register();
    open('k3', 'lodged');
    expect(read('k3').decided_at).toBeNull();
    db.prepare(`UPDATE cases SET status = 'approved' WHERE id = 'k3'`).run();
    expect(read('k3').decided_at).not.toBeNull();
  });

  it('never overwrites a date somebody recorded', () => {
    // It has no better information than the person who typed it.
    const { db, open, read } = register();
    open('k4', 'approved', '2026-06-12T00:00:00Z');
    expect(read('k4').decided_at).toBe('2026-06-12T00:00:00Z');
    db.prepare(`UPDATE cases SET status = 'declined' WHERE id = 'k4'`).run();
    expect(read('k4').decided_at).toBe('2026-06-12T00:00:00Z');
  });

  it('leaves an undecided matter alone', () => {
    const { open, read } = register();
    for (const [id, status] of [['k5', 'lodged'], ['k6', 'preparing'], ['k7', 'lead']] as const) {
      open(id, status);
      expect(read(id).decided_at, status).toBeNull();
    }
  });

  it('treats withdrawn and closed as endings, not decisions', () => {
    // Nobody decided them — the practice or the client stopped.
    const { open, read } = register();
    open('k8', 'withdrawn');
    open('k9', 'closed');
    expect(read('k8').decided_at).toBeNull();
    expect(read('k9').decided_at).toBeNull();
  });

  it('holds against a bulk insert, which is how the nine got in', () => {
    const { db, read } = register();
    db.exec(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                created_at, updated_at)
             SELECT 'kb' || value, 'CASE-26-B' || value, 'c1', 'Loaded', 'wv_aewv', 'approved',
                    'u1', '${AT}', '${AT}'
               FROM (SELECT 1 AS value UNION ALL SELECT 2 UNION ALL SELECT 3)`);
    for (const id of ['kb1', 'kb2', 'kb3']) expect(read(id).decided_at, id).not.toBeNull();
  });
});

describe('how the decision reads on the file', () => {
  it('names the outcome first, then when', () => {
    expect(decisionLine({ status: 'approved', decided_at: '2026-09-04T00:00:00Z', outcome: 'approved' }))
      .toBe('Approved · 04 Sept 2026');
  });

  it('does not repeat the status back as its own outcome', () => {
    // `outcome` holds one word on most matters, so "Approved — approved" is
    // exactly what this must not produce.
    for (const outcome of ['approved', 'Approved', 'APPROVED', '']) {
      expect(decisionLine({ status: 'approved', decided_at: '2026-09-04T00:00:00Z', outcome }))
        .toBe('Approved · 04 Sept 2026');
    }
  });

  it('shows an outcome that says more than the status does', () => {
    const line = decisionLine({
      status: 'approved', decided_at: '2026-09-04T00:00:00Z',
      outcome: 'Granted for 24 months with a condition on the employer',
    });
    expect(line).toBe('Approved — Granted for 24 months with a condition on the employer · 04 Sept 2026');
  });

  it('says plainly when the date is missing, and where to fix it', () => {
    // The nine existing matters read this way until somebody fills them in.
    expect(decisionLine({ status: 'declined', decided_at: null, outcome: null }))
      .toBe('Declined · date not recorded — add it under Edit');
  });

  it('knows which statuses are decisions', () => {
    expect(isDecidedStatus('approved')).toBe(true);
    expect(isDecidedStatus('declined')).toBe(true);
    for (const s of ['withdrawn', 'closed', 'lodged', 'ppi', 'lead']) {
      expect(isDecidedStatus(s), s).toBe(false);
    }
  });
});

describe('how long it took, or has taken', () => {
  const on = (lodged: string | null, decided: string | null, today = '2026-09-04') =>
    elapsedLine({ lodged_at: lodged, decided_at: decided }, today);

  it('counts from lodgement to the decision', () => {
    expect(on('2026-06-09', '2026-09-04')).toBe('87 days (about 2 months)');
  });

  it('counts to today while it is still running', () => {
    expect(on('2026-08-30', null)).toBe('5 days');
  });

  it('reads naturally at the small end', () => {
    expect(on('2026-09-04', '2026-09-04')).toBe('same day');
    expect(on('2026-09-03', '2026-09-04')).toBe('1 day');
    expect(on('2026-08-06', '2026-09-04')).toBe('29 days');
  });

  it('draws nothing when there is nothing to count from', () => {
    expect(on(null, '2026-09-04')).toBeNull();
    expect(on(null, null)).toBeNull();
  });

  it('refuses to report a negative span', () => {
    // A decision before the lodgement is a contradiction the alerts page
    // already names; this must not answer it with "-40 days".
    expect(on('2026-09-04', '2026-07-25')).toBeNull();
  });
});

describe('the panel, as a person opening the file sees it', () => {
  function seeded(status: string, extra: Record<string, string | null> = {}) {
    const h = mountModule(casesModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                  VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
      .run(USER.id, USER.email, USER.name, AT, AT);
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
    h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, priority,
                                     assigned_to, lodged_at, decision_due_at, decided_at, outcome,
                                     created_at, updated_at)
                  VALUES ('k1','CASE-26-001','c1','A matter','wv_aewv',?,?,?,?,?,?,?,?,?)`)
      .run(status, extra.priority ?? 'normal', USER.id, extra.lodged_at ?? null,
           extra.decision_due_at ?? null, extra.decided_at ?? null, extra.outcome ?? null, AT, AT);
    return h;
  }
  const panel = async (h: ReturnType<typeof seeded>) => {
    const body = await (await h.request('/cases/k1')).text();
    const i = body.indexOf('Key details');
    return body.slice(i, body.indexOf('</dl>', i));
  };

  it('says which way a decided matter went, not just a date', async () => {
    const p = await panel(seeded('approved', { decided_at: '2026-09-04T00:00:00Z', outcome: 'approved' }));
    expect(p).toContain('Decision');
    expect(p).toContain('Approved');
    expect(p).not.toContain('<dt>Decided</dt>');
  });

  it('shows the status on a matter that has not been decided', async () => {
    const p = await panel(seeded('lodged'));
    expect(p).toContain('<dt>Status</dt>');
    expect(p).toContain('Lodged');
    expect(p).not.toContain('<dt>Decision</dt>');
  });

  it('drops the due date once nothing is awaited', async () => {
    // A date under "Due" on a decided matter reads as a missed deadline.
    const live = await panel(seeded('lodged', { decision_due_at: '2026-12-01' }));
    expect(live).toContain('<dt>Due</dt>');
    const done = await panel(seeded('approved',
      { decision_due_at: '2026-12-01', decided_at: '2026-09-04T00:00:00Z' }));
    expect(done).not.toContain('<dt>Due</dt>');
  });

  it('does not spend a row saying the priority is normal', async () => {
    expect(await panel(seeded('lodged'))).not.toContain('<dt>Priority</dt>');
    expect(await panel(seeded('lodged', { priority: 'high' }))).toContain('<dt>Priority</dt>');
  });

  it('says how long it took, or how long it has been waiting', async () => {
    const done = await panel(seeded('approved',
      { lodged_at: '2026-06-09', decided_at: '2026-09-04T00:00:00Z' }));
    expect(done).toContain('<dt>Took</dt>');
    const live = await panel(seeded('lodged', { lodged_at: '2026-06-09' }));
    expect(live).toContain('<dt>Waiting</dt>');
  });
});

describe('a decision date can actually be typed', () => {
  it('is offered on the form', () => {
    // It could not be entered anywhere before, which is why the nine matters
    // could not be corrected from the interface.
    const src = readFileSync('src/modules/cases/index.ts', 'utf8');
    expect(src).toContain("name: 'decided_at', type: 'date'");
  });

  it('is written when a matter is corrected, and survives the trigger', async () => {
    // This is the route that fixes the nine: open the matter, type the date the
    // decision actually arrived, save. The trigger fills blanks and must not
    // touch a date somebody typed.
    const h = mountModule(casesModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                  VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
      .run(USER.id, USER.email, USER.name, AT, AT);
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
    // A matter in the state the nine are in: approved, no decision date. It has
    // to be inserted with the trigger's own stamp cleared, because the trigger
    // is what stops this state arising in the first place.
    h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, descriptor, case_type, status,
                                     priority, assigned_to, lodged_at, created_at, updated_at)
                  VALUES ('k1','CASE-26-001','c1','A matter','A matter','wv_aewv','approved',
                          'normal', ?, '2026-06-09', ?, ?)`).run(USER.id, AT, AT);
    h.db.prepare(`UPDATE cases SET decided_at = NULL WHERE id = 'k1'`).run();
    expect(h.get<{ decided_at: string | null }>(
      'SELECT decided_at FROM cases WHERE id = ?', 'k1')?.decided_at).toBeNull();

    const res = await h.post('/cases/k1', {
      client_id: 'c1', descriptor: 'A matter', case_type: 'wv_aewv',
      priority: 'normal', assigned_to: USER.id,
      lodged_at: '2026-06-09', decided_at: '2026-07-25',
    });
    expect(res.status).toBe(303);
    expect(h.get<{ decided_at: string }>(
      'SELECT decided_at FROM cases WHERE id = ?', 'k1')?.decided_at).toBe('2026-07-25');
  });

  it('does not lose a decision date when the matter is edited for something else', async () => {
    // The edit route now writes `decided_at` on every save, so a form that did
    // not carry the existing value would quietly empty it on 123 decided
    // matters. The field is fed from the row, and this is what proves it.
    const h = mountModule(casesModule, { user: USER });
    h.db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
                  VALUES (?, ?, ?, 'x', 'admin', 'active', ?, ?)`)
      .run(USER.id, USER.email, USER.name, AT, AT);
    h.db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                  VALUES ('c1','CL-9001','individual','A Person','active',?,?)`).run(AT, AT);
    h.db.prepare(`INSERT INTO cases (id, ref, client_id, title, descriptor, case_type, status,
                                     priority, assigned_to, decided_at, created_at, updated_at)
                  VALUES ('k1','CASE-26-001','c1','A matter','A matter','wv_aewv','approved',
                          'normal', ?, '2026-07-25', ?, ?)`).run(USER.id, AT, AT);

    // The form as the browser renders it, then submitted back unchanged apart
    // from the description.
    const form = await (await h.request('/cases/k1/edit')).text();
    const prefilled = form.match(/name="decided_at"[^>]*value="([^"]*)"/)?.[1];
    expect(prefilled, 'the field must arrive carrying the stored date').toBe('2026-07-25');

    const res = await h.post('/cases/k1', {
      client_id: 'c1', descriptor: 'A renamed matter', case_type: 'wv_aewv',
      priority: 'normal', assigned_to: USER.id, decided_at: prefilled!,
    });
    expect(res.status).toBe(303);
    const row = h.get<{ decided_at: string; descriptor: string }>(
      'SELECT decided_at, descriptor FROM cases WHERE id = ?', 'k1');
    expect(row?.descriptor).toBe('A renamed matter');
    expect(row?.decided_at).toBe('2026-07-25');
  });

  it('closes the route the practice actually came in by', () => {
    // The matter that prompted this was entered through the intake tool, which
    // accepts any status and never wrote a decision date. That insert is
    // unchanged — the database covers it now, which is the point of putting the
    // rule there rather than in a third handler.
    const intake = readFileSync('src/modules/assistant/intake.ts', 'utf8');
    expect(intake).toContain("f.enum('status', CASE_STATUSES");
    expect(intake).not.toContain('decided_at');
  });
});
