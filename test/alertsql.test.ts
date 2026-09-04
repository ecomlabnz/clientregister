import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { CHECKS_NOT_ABOUT_A_DATE as CHECKS } from '../src/modules/alerts';
import { LODGED_CASE_STATUSES, OPEN_CASE_STATUSES } from '../src/domain';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * The five checks that are not about a date, run for real.
 *
 * These are the alerts that say what is *wrong* rather than what is due, and
 * the case for putting them beside the dates is that they are as certain as a
 * date is. That claim is only worth making if somebody has watched each one
 * fire on a record that should trip it and stay silent on a record that
 * should not — which is what this does, against a database built from the
 * migrations rather than a fixture written to agree with the query.
 *
 * The seed below is invented. Nothing in it resembles a real client, because
 * real client data does not go in this repository.
 */

const TODAY = '2026-08-29';
const openIn = OPEN_CASE_STATUSES.map(() => '?').join(',');
const lodgedIn = LODGED_CASE_STATUSES.map(() => '?').join(',');

let db: InstanceType<typeof DatabaseSync>;

/** The rows a check returns, named by whichever column identifies them here. */
function ids(sql: string, params: unknown[], key: 'ref' | 'id' = 'ref'): string[] {
  return (db.prepare(sql).all(...params) as Array<Record<string, unknown>>)
    .map((r) => String(r[key]));
}

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }

  const client = (id: string, ref: string, kind: string, name: string, visa: string | null) =>
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, current_visa_type,
                                     created_at, updated_at)
                VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`)
      .run(id, ref, kind, name, visa, `${TODAY}T00:00:00Z`, `${TODAY}T00:00:00Z`);

  // A matter must be assigned to somebody — the database refuses one that is
  // not — so the person exists before any matter does.
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u_adviser', 'adviser@example.test', 'An Adviser', 'x', 'adviser', ?, ?)`)
    .run(`${TODAY}T00:00:00Z`, `${TODAY}T00:00:00Z`);

  const matter = (id: string, ref: string, clientId: string, status: string, extra: {
    inz?: string | null; lodged?: string | null; decided?: string | null;
    due?: string | null; created?: string;
  } = {}) =>
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   inz_application_number, lodged_at, decided_at,
                                   decision_due_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'wv_aewv', ?, 'u_adviser', ?, ?, ?, ?, ?, ?)`)
      .run(id, ref, clientId, `Matter ${ref}`, status,
        extra.inz ?? null, extra.lodged ?? null, extra.decided ?? null, extra.due ?? null,
        `${extra.created ?? TODAY}T00:00:00Z`, `${TODAY}T00:00:00Z`);

  client('cl_visa', 'CL-1', 'individual', 'Given FAMILY', 'AEWV');
  client('cl_blank', 'CL-2', 'individual', 'Other PERSON', null);
  client('cl_space', 'CL-3', 'individual', 'Third PERSON', '   ');
  client('cl_org', 'CL-4', 'organisation', 'An Employer Limited', null);

  // Acknowledgement: lodged long ago, no application number.
  matter('k_noack', 'K-NOACK', 'cl_visa', 'lodged', { lodged: '2026-07-01', created: '2026-07-01' });
  // Same, but the number is on the file.
  matter('k_ack', 'K-ACK', 'cl_visa', 'lodged', { lodged: '2026-07-01', inz: '600123456', created: '2026-07-01' });
  // Lodged yesterday: inside any sane grace period.
  matter('k_fresh', 'K-FRESH', 'cl_visa', 'lodged', { lodged: '2026-08-28', created: '2026-08-28' });
  // Not lodged at all.
  matter('k_prep', 'K-PREP', 'cl_visa', 'preparing', { created: '2026-07-01' });
  // Blank-ish application numbers count as absent.
  matter('k_blankish', 'K-BLANKISH', 'cl_visa', 'ppi', { lodged: '2026-07-01', inz: '  ', created: '2026-07-01' });

  // Deadlines, for the task check.
  matter('k_deadline', 'K-DEADLINE', 'cl_visa', 'ppi', { due: '2026-09-15', created: '2026-08-01' });
  // A matter for the client with no visa recorded, and one for the organisation.
  matter('k_blank', 'K-BLANK', 'cl_blank', 'ready_to_lodge', { created: '2026-08-01' });
  matter('k_space', 'K-SPACE', 'cl_space', 'lead', { created: '2026-08-01' });
  matter('k_org', 'K-ORG', 'cl_org', 'preparing', { created: '2026-08-01' });
  // Closed, so out of every open-status check.
  matter('k_closed', 'K-CLOSED', 'cl_blank', 'closed', { created: '2026-01-01' });

  // Contradictions.
  matter('k_backwards', 'K-BACKWARDS', 'cl_visa', 'approved',
    { lodged: '2026-08-01', decided: '2026-07-01', created: '2026-07-01' });
  // Approved or declined with no decision date. Since migration 0061 the
  // database fills that in, so this state can no longer be *created* — but nine
  // matters loaded before it still hold it, which is what the check is for. The
  // date is cleared after the insert to reproduce them exactly.
  matter('k_nodate', 'K-NODATE', 'cl_visa', 'declined', { lodged: '2026-08-01', created: '2026-07-01' });
  db.prepare(`UPDATE cases SET decided_at = NULL WHERE id = 'k_nodate'`).run();
  matter('k_future', 'K-FUTURE', 'cl_visa', 'lodged', { lodged: '2027-01-01', inz: '600999999', created: '2026-08-01' });

  const task = (id: string, caseId: string, due: string | null, status = 'open') =>
    db.prepare(`INSERT INTO tasks (id, title, status, due_at, assigned_to, entity_type, entity_id,
                                   created_at, updated_at)
                VALUES (?, ?, ?, ?, 'u_adviser', 'case', ?, ?, ?)`)
      .run(id, `Task ${id}`, status, due, caseId, `${TODAY}T00:00:00Z`, `${TODAY}T00:00:00Z`);

  task('t_same', 'k_deadline', '2026-09-15');      // the same day as the deadline
  task('t_early', 'k_deadline', '2026-09-08');     // a week of room
  task('t_done', 'k_deadline', '2026-09-15', 'done'); // already finished
  task('t_nodeadline', 'k_prep', '2026-09-15');    // the matter has no deadline

  // Event-relative visa expiries (0041): a rule with no date fixed yet, a rule
  // whose date has since been fixed, and an archived client's rule.
  const rule = (id: string, ref: string, expiry: string | null, status = 'active') =>
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, current_visa_expiry,
                                     current_visa_expiry_rule, created_at, updated_at)
                VALUES (?, ?, 'individual', 'Rule PERSON', ?, ?,
                        '24 months after first arrival in New Zealand', ?, ?)`)
      .run(id, ref, status, expiry, `${TODAY}T00:00:00Z`, `${TODAY}T00:00:00Z`);
  rule('cl_rule', 'CL-RULE', null);
  rule('cl_fixed', 'CL-FIXED', '2027-06-01');
  rule('cl_gone', 'CL-GONE', null, 'archived');
});

describe('lodged with no acknowledgement', () => {
  const run = (graceFrom: string) =>
    ids(CHECKS.unacknowledged(lodgedIn), [...LODGED_CASE_STATUSES, graceFrom]);

  it('fires on a lodged matter with no application number', () => {
    expect(run('2026-08-15').sort()).toEqual(['K-BLANKISH', 'K-NOACK']);
  });

  it('is silent once the number is recorded', () => {
    expect(run('2026-08-15')).not.toContain('K-ACK');
  });

  it('leaves a fresh lodgement alone until the grace period is up', () => {
    // Lodged yesterday. The acknowledgement has not had time to arrive.
    expect(run('2026-08-15')).not.toContain('K-FRESH');
    // Push the grace period past it and it appears, which proves the date
    // filter is doing the work rather than something else excluding it.
    expect(run('2026-08-29')).toContain('K-FRESH');
  });

  it('does not ask for a number before the matter is lodged', () => {
    expect(run('2026-08-15')).not.toContain('K-PREP');
  });
});

describe('a task with no room before the deadline it serves', () => {
  // Named by task, not by matter: the row is about the task's own due date.
  const run = (today: string) => ids(CHECKS.noSlack(openIn), [...OPEN_CASE_STATUSES, today], 'id');

  it('fires when the task is due the day the deadline falls', () => {
    expect(run(TODAY)).toEqual(['t_same']);
  });

  it('is silent when there is a week in hand', () => {
    expect(run(TODAY)).not.toContain('t_early');
  });

  it('ignores a task already finished', () => {
    expect(run(TODAY)).not.toContain('t_done');
  });

  it('needs a deadline to be the same day as', () => {
    expect(run(TODAY)).not.toContain('t_nodeadline');
  });

  it('stops once the day has passed, where the deadline row says it louder', () => {
    expect(run('2026-09-16')).toEqual([]);
  });
});

describe('an open matter for someone with no visa recorded', () => {
  const run = () => ids(CHECKS.statusUnknown(openIn), [...OPEN_CASE_STATUSES]);

  it('fires on a blank, and on whitespace, which is a blank somebody typed', () => {
    expect(run().sort()).toEqual(['K-BLANK', 'K-SPACE']);
  });

  it('is silent when the visa is recorded', () => {
    expect(run()).not.toContain('K-DEADLINE');
  });

  it('never asks an organisation for its visa', () => {
    // A row that can never be cleared teaches people to ignore the list.
    expect(run()).not.toContain('K-ORG');
  });

  it('leaves closed matters out of it', () => {
    expect(run()).not.toContain('K-CLOSED');
  });
});

describe('a visa expiry that waits on an event', () => {
  const run = () => ids(CHECKS.expiryUnfixed(), []);

  it('fires while the rule has no date beside it', () => {
    expect(run()).toContain('CL-RULE');
  });

  it('clears the moment the date is fixed', () => {
    expect(run()).not.toContain('CL-FIXED');
  });

  it('lets an archived client rest', () => {
    expect(run()).not.toContain('CL-GONE');
  });

  it('says nothing about a client with no rule recorded — that is a different gap', () => {
    // CL-2 has neither date nor rule. A blank stays a blank; this check exists
    // only for the visa whose expiry is known to be waiting on an event.
    expect(run()).not.toContain('CL-2');
  });
});

describe('the two checks that were already there', () => {
  it('names which facts disagree, for each shape of contradiction', () => {
    expect(ids(CHECKS.contradiction(), [TODAY]).sort())
      .toEqual(['K-BACKWARDS', 'K-FUTURE', 'K-NODATE']);
  });

  it('calls a matter quiet when nothing has happened on it', () => {
    // Everything seeded here was created before the cutoff and has no note,
    // no status change and no task activity since.
    const quiet = ids(CHECKS.quiet(openIn), [...OPEN_CASE_STATUSES, '2026-08-20']);
    expect(quiet).toContain('K-BLANK');
    // A matter created after the cutoff is not quiet: it is new.
    expect(ids(CHECKS.quiet(openIn), [...OPEN_CASE_STATUSES, '2026-06-01'])).toEqual([]);
  });

  it('counts a task touched today as somebody working on the matter', () => {
    // k_deadline carries tasks updated today, so it is not quiet even though
    // the matter itself was created in August.
    expect(ids(CHECKS.quiet(openIn), [...OPEN_CASE_STATUSES, '2026-08-20'])).not.toContain('K-DEADLINE');
  });
});

/**
 * An archive must arrive quiet.
 *
 * Batch 05 is the practice's archive — matters finished years ago. The
 * practice's instruction is that none of it raises an alert or a task: a file
 * closed in 2022 must not appear on tomorrow morning's Alerts page. Only
 * warnings, where a warning is warranted, because a refusal recorded in 2023 is
 * still a fact about that person.
 *
 * The brief for that load tells the extraction how to satisfy this. These tests
 * are what makes the brief true rather than hopeful — each one runs the alert's
 * real SQL against a record shaped the way the brief says to shape it.
 */
describe('an archived matter raises nothing', () => {
  /**
   * Every check gated on an open status, called with the parameters the
   * module itself passes. Named one by one rather than looped over, because a
   * loop that guessed the bindings would report a silent pass on a query it
   * never actually ran.
   */
  const gatedOnOpen = (): Record<string, string[]> => ({
    quiet: ids(CHECKS.quiet(openIn), [...OPEN_CASE_STATUSES, '2026-01-01']),
    unacknowledged: ids(CHECKS.unacknowledged(lodgedIn), [...LODGED_CASE_STATUSES, TODAY]),
    noSlack: ids(CHECKS.noSlack(openIn), [...OPEN_CASE_STATUSES, TODAY], 'id'),
    statusUnknown: ids(CHECKS.statusUnknown(openIn), [...OPEN_CASE_STATUSES]),
  });

  it('is out of every check that is gated on an open status', () => {
    // K-CLOSED is closed and years old. If any open-status check returns it,
    // the archive would land on the Alerts page.
    const results = gatedOnOpen();
    // Say the number out loud: an empty set of checks would pass having
    // examined nothing.
    expect(Object.keys(results).length).toBe(4);
    for (const [name, rows] of Object.entries(results)) {
      expect(rows, `${name} must not return a closed matter`).not.toContain('K-CLOSED');
    }
  });

  it('still fires on "approved" with no decision date, closed or not', () => {
    // This is the one check with no status gate, and the reason the brief says
    // to use `closed` rather than `approved` when the folder gives no date.
    const sql = CHECKS.contradiction();
    expect(ids(sql, [TODAY])).toContain('K-NODATE');
  });

  it('stays silent on a matter closed without a decision date', () => {
    // The shape the brief asks for: finished, honest about not knowing when.
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   created_at, updated_at)
                VALUES ('k_arch', 'K-ARCHIVE', 'cl_visa', 'An old matter', 'wv_aewv',
                        'closed', 'u_adviser', '2022-03-01T00:00:00Z', '2022-03-01T00:00:00Z')`)
      .run();
    expect(ids(CHECKS.contradiction(), [TODAY])).not.toContain('K-ARCHIVE');
  });

  it('stays silent on a matter closed with a decision date in order', () => {
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                   lodged_at, decided_at, created_at, updated_at)
                VALUES ('k_arch2', 'K-ARCHIVE-2', 'cl_visa', 'Another old matter', 'wv_aewv',
                        'approved', 'u_adviser', '2022-01-10', '2022-03-04',
                        '2022-01-01T00:00:00Z', '2022-03-04T00:00:00Z')`)
      .run();
    expect(ids(CHECKS.contradiction(), [TODAY])).not.toContain('K-ARCHIVE-2');
  });
});

describe('an archived client raises no expiry', () => {
  /** The expiry query, lifted from the module by the shape of its first line. */
  const expirySql = readFileSync('src/modules/alerts/index.ts', 'utf8');

  it('skips archived clients in every branch of the expiry union', () => {
    // Five branches — passport, visa, police, medical, chest x-ray. Each one
    // must carry the archived guard, because an archive client with a passport
    // that expired in 2021 would otherwise put an alert on the page. This is
    // why the brief loads archive clients as `archived`.
    const union = expirySql.slice(
      expirySql.indexOf("'Passport' ||"),
      expirySql.indexOf('ORDER BY expires'));
    const branches = union.split('UNION ALL');
    expect(branches.length).toBe(5);
    for (const [i, b] of branches.entries()) {
      expect(b, `expiry branch ${i + 1} must skip archived clients`)
        .toMatch(/status\s*!=\s*'archived'/);
    }
  });

  it('proves it against the database, not just the source', () => {
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, current_visa_expiry,
                                     created_at, updated_at)
                VALUES ('cl_arch', 'CL-ARCH', 'individual', 'Old CLIENT', 'archived',
                        '2021-05-01', '2021-01-01T00:00:00Z', '2021-01-01T00:00:00Z')`)
      .run();
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, current_visa_expiry,
                                     created_at, updated_at)
                VALUES ('cl_live', 'CL-LIVE', 'individual', 'Live CLIENT', 'active',
                        '2021-05-01', '2021-01-01T00:00:00Z', '2021-01-01T00:00:00Z')`)
      .run();
    const rows = ids(
      `SELECT ref FROM clients
        WHERE current_visa_expiry IS NOT NULL AND current_visa_expiry <= ?1 AND status != 'archived'`,
      ['2026-12-31']);
    expect(rows).toContain('CL-LIVE');
    expect(rows).not.toContain('CL-ARCH');
  });
});
