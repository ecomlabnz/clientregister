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

  const matter = (id: string, ref: string, clientId: string, status: string, extra: {
    inz?: string | null; lodged?: string | null; decided?: string | null;
    due?: string | null; created?: string;
  } = {}) =>
    db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status,
                                   inz_application_number, lodged_at, decided_at,
                                   decision_due_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'wv_aewv', ?, ?, ?, ?, ?, ?, ?)`)
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
  matter('k_blankish', 'K-BLANKISH', 'cl_visa', 'inz_rfi', { lodged: '2026-07-01', inz: '  ', created: '2026-07-01' });

  // Deadlines, for the task check.
  matter('k_deadline', 'K-DEADLINE', 'cl_visa', 'inz_rfi', { due: '2026-09-15', created: '2026-08-01' });
  // A matter for the client with no visa recorded, and one for the organisation.
  matter('k_blank', 'K-BLANK', 'cl_blank', 'ready_to_lodge', { created: '2026-08-01' });
  matter('k_space', 'K-SPACE', 'cl_space', 'lead', { created: '2026-08-01' });
  matter('k_org', 'K-ORG', 'cl_org', 'preparing', { created: '2026-08-01' });
  // Closed, so out of every open-status check.
  matter('k_closed', 'K-CLOSED', 'cl_blank', 'closed', { created: '2026-01-01' });

  // Contradictions.
  matter('k_backwards', 'K-BACKWARDS', 'cl_visa', 'approved',
    { lodged: '2026-08-01', decided: '2026-07-01', created: '2026-07-01' });
  matter('k_nodate', 'K-NODATE', 'cl_visa', 'declined', { lodged: '2026-08-01', created: '2026-07-01' });
  matter('k_future', 'K-FUTURE', 'cl_visa', 'lodged', { lodged: '2027-01-01', inz: '600999999', created: '2026-08-01' });

  // A task is always assigned to somebody — the database refuses one that is
  // not — so the seed needs a person to assign them to.
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u_adviser', 'adviser@example.test', 'An Adviser', 'x', 'adviser', ?, ?)`)
    .run(`${TODAY}T00:00:00Z`, `${TODAY}T00:00:00Z`);

  const task = (id: string, caseId: string, due: string | null, status = 'open') =>
    db.prepare(`INSERT INTO tasks (id, title, status, due_at, assigned_to, entity_type, entity_id,
                                   created_at, updated_at)
                VALUES (?, ?, ?, ?, 'u_adviser', 'case', ?, ?, ?)`)
      .run(id, `Task ${id}`, status, due, caseId, `${TODAY}T00:00:00Z`, `${TODAY}T00:00:00Z`);

  task('t_same', 'k_deadline', '2026-09-15');      // the same day as the deadline
  task('t_early', 'k_deadline', '2026-09-08');     // a week of room
  task('t_done', 'k_deadline', '2026-09-15', 'done'); // already finished
  task('t_nodeadline', 'k_prep', '2026-09-15');    // the matter has no deadline
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
