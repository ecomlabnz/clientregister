/**
 * A practice's worth of invented files, for somebody learning the register.
 *
 * **Asked for on 11 September 2026:** *"Need to create about 12 test clients
 * with various parties attached, 1-3 quotes issued, various complications - 3-5
 * cases per main applicant - test data, make it rich. Mark it as test data so
 * it is easy to delete ... and the test data can be reset to initial state or
 * auto resets in 15 days - so extra data that a user may have entered - is
 * disregarded. - This is so that some users can try the system and learn."*
 *
 * Three things have to hold, and none of them is obvious from reading the seed:
 *
 *  * **Every row is marked.** A fabricated client that is not marked as test
 *    data is a fabricated client sitting in the register for ever, and on this
 *    register that is beside real files.
 *  * **The purge takes all of it.** *"so it can be deleted later on without any
 *    further questions."* A seed that leaves orphans behind is a seed that
 *    cannot be run twice.
 *  * **The timer does nothing unless somebody turned it on.** This code runs on
 *    the practice's own register every night, where the marked records are two
 *    quotations they marked by hand. A default of fifteen days would delete
 *    them without being asked.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeD1, migratedSqlite } from './support/d1';
import type { Env } from '../src/types';
import {
  AUTO_RESET_DAYS, SEEDED_AT, autoResetIfDue, resetTestData, seedState, seedTestData,
} from '../src/core/testseed';
import { purgeTestData, tallyTestData } from '../src/core/testdata';
import { CASE_STATUSES } from '../src/domain';

const AT = '2026-09-11T09:00:00Z';

function register() {
  const db = migratedSqlite();
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
              VALUES ('u1','a@example.test','A Tester','x','admin','active',?,?)`).run(AT, AT);
  const env = { DB: fakeD1(db) } as unknown as Env;
  const count = (sql: string) => ((db.prepare(sql) as any).get() as { n: number }).n;
  return { db, env, count };
}

/** A register with the caseload already laid down, and a way to read it. */
async function seeded() {
  const db = migratedSqlite();
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
              VALUES ('u1','a@example.test','A Tester','x','admin','active',?,?)`).run(AT, AT);
  const env = { DB: fakeD1(db) } as unknown as Env;
  await seedTestData(env, 'u1');
  return {
    env,
    count: (sql: string) => ((db.prepare(sql) as any).get() as { n: number }).n,
    rows: <T>(sql: string): T[] => (db.prepare(sql) as any).all() as T[],
  };
}

/** The practice's own vocabulary, read rather than copied. */
const VOCABULARY_SOURCE = readFileSync('src/core/vocabulary.ts', 'utf8');

const MARKED = ['clients', 'cases', 'quotes', 'tasks'];
const UNDER = [
  'client_passports', 'client_certificates', 'client_nationalities',
  'client_employment', 'client_education', 'client_travel',
  'case_parties', 'entries', 'flags',
];

describe('the caseload that is laid down', () => {
  it('is about twelve files with matters and quotations on them', async () => {
    const { env, count } = register();
    const result = await seedTestData(env, 'u1');
    expect(result.clients).toBeGreaterThanOrEqual(12);
    expect(result.cases).toBe(20);
    expect(result.quotes).toBeGreaterThanOrEqual(12);
    expect(count('SELECT COUNT(*) AS n FROM clients')).toBe(result.clients);
  });

  it('gives every main applicant more than one matter', async () => {
    // *"3-5 cases per main applicant."* Counted rather than asserted exactly,
    // because the point is a file with a history rather than a number.
    const { db, env } = register();
    await seedTestData(env, 'u1');
    const rows = db.prepare(
      `SELECT client_id, COUNT(*) AS n FROM cases GROUP BY client_id`).all() as Array<{ n: number }>;
    const busy = rows.filter((r) => r.n >= 2);
    expect(busy.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...rows.map((r) => r.n))).toBeGreaterThanOrEqual(3);
  });

  it('uses only statuses the register actually has', async () => {
    // **This test used to assert the bug.** It required `awaiting_information`
    // to be present — a status that is not in `CASE_STATUSES` and never has
    // been — so the seed wrote it, the matter displayed the raw key instead of
    // a label, and the test went green. A second matter carried `open`, equally
    // invented. The practice spotted both in the trial on 12 September 2026,
    // on the page a prospective customer would open first.
    //
    // A test that names the values it wants can only ever check the ones
    // somebody thought of. This checks the whole set against the register's own
    // list, so an invented status fails whatever it is called.
    const { db, env } = register();
    await seedTestData(env, 'u1');
    const statuses = new Set((db.prepare('SELECT DISTINCT status AS s FROM cases').all() as Array<{ s: string }>)
      .map((r) => r.s));
    for (const s of statuses) {
      expect(CASE_STATUSES as readonly string[], `${s} is not a case status`).toContain(s);
    }
    // And it still has to be a caseload with something wrong in it, or it
    // shows nothing of what the register is for.
    for (const s of ['declined', 'on_hold', 'approved', 'lodged']) {
      expect(statuses, s).toContain(s);
    }
    expect(statuses.size).toBeGreaterThanOrEqual(5);
    const quoteStatuses = new Set(
      (db.prepare('SELECT DISTINCT status AS s FROM quotes').all() as Array<{ s: string }>)
        .map((r) => r.s));
    expect(quoteStatuses).toContain('accepted');
    expect(quoteStatuses).toContain('declined');
  });

  it('includes a period of unemployment, with its note', async () => {
    // The thing the practice called critical about the employment history. A
    // caseload without one does not show that it is possible.
    const { db, env } = register();
    await seedTestData(env, 'u1');
    const stmt = db.prepare(
      `SELECT notes FROM client_employment WHERE kind = 'unemployed' AND notes IS NOT NULL LIMIT 1`);
    const row = (stmt as any).get() as { notes: string } | undefined;
    expect(row?.notes).toBeTruthy();
  });

  it('includes a passport that has been replaced and one that has not', async () => {
    const { db, env } = register();
    await seedTestData(env, 'u1');
    const statuses = new Set(
      (db.prepare('SELECT DISTINCT status AS s FROM client_passports').all() as Array<{ s: string }>)
        .map((r) => r.s));
    expect(statuses).toContain('held');
    expect(statuses).toContain('replaced');
  });

  it('leaves no quotation frozen, so it can be played with', async () => {
    // A quotation with `accepted_at` set is frozen by migration 0079 — which is
    // right on a real contract and useless on a caseload somebody is learning
    // from. So the seeded accepted quotations are accepted by status only.
    const { count, env } = register();
    await seedTestData(env, 'u1');
    expect(count('SELECT COUNT(*) AS n FROM quotes WHERE accepted_at IS NOT NULL')).toBe(0);
  });
});

describe('all of it is marked as test data', () => {
  it.each(MARKED)('every row of %s carries the mark', async (table) => {
    const { count, env } = register();
    await seedTestData(env, 'u1');
    expect(count(`SELECT COUNT(*) AS n FROM ${table} WHERE is_test = 0`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM ${table}`)).toBeGreaterThan(0);
  });

  it('shows in the tally the Test data screen reads', async () => {
    const { env } = register();
    await seedTestData(env, 'u1');
    const tally = await tallyTestData(env);
    const byTable = Object.fromEntries(tally.map((t) => [t.table, t.count]));
    expect(byTable.clients).toBeGreaterThanOrEqual(12);
    expect(byTable.cases).toBe(20);
    expect(byTable.quotes).toBeGreaterThanOrEqual(12);
  });
});

describe('the purge takes all of it', () => {
  it('leaves nothing behind, in any table', async () => {
    const { count, env } = register();
    await seedTestData(env, 'u1');
    await purgeTestData(env, 'u1');
    for (const table of [...MARKED, ...UNDER]) {
      expect(count(`SELECT COUNT(*) AS n FROM ${table}`), table).toBe(0);
    }
  });

  it('so the caseload can be laid down twice over', async () => {
    // Which is the whole of what "reset to initial state" is.
    const { env } = register();
    const first = await seedTestData(env, 'u1');
    const second = await resetTestData(env, 'u1');
    expect(second.clients).toBe(first.clients);
    expect(second.cases).toBe(first.cases);
  });

  it('and a reset disregards what somebody added in between', async () => {
    // *"so extra data that a user may have entered - is disregarded."*
    const { db, count, env } = register();
    await seedTestData(env, 'u1');
    db.prepare(
      `INSERT INTO clients (id, ref, kind, full_name, status, is_test, created_at, updated_at)
       VALUES ('mine','CL-8001','individual','Somebody I added','active',1,?,?)`).run(AT, AT);
    await resetTestData(env, 'u1');
    expect(count(`SELECT COUNT(*) AS n FROM clients WHERE id = 'mine'`)).toBe(0);
  });
});

describe('the timer does nothing unless somebody turned it on', () => {
  it('is off with no setting, however long ago the caseload was laid down', async () => {
    // The test that matters on the practice's own register, where the marked
    // records are two quotations they marked by hand to rehearse with.
    const { db, count, env } = register();
    await seedTestData(env, 'u1');
    db.prepare(`UPDATE settings SET value = '2020-01-01T00:00:00.000Z' WHERE key = ?`).run(SEEDED_AT);
    expect(await autoResetIfDue(env)).toBe(null);
    expect(count('SELECT COUNT(*) AS n FROM clients')).toBeGreaterThan(0);
  });

  it('is off when the setting says zero', async () => {
    const { db, env } = register();
    await seedTestData(env, 'u1');
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,'0',?)`)
      .run(AUTO_RESET_DAYS, AT);
    db.prepare(`UPDATE settings SET value = '2020-01-01T00:00:00.000Z' WHERE key = ?`).run(SEEDED_AT);
    expect(await autoResetIfDue(env)).toBe(null);
  });

  it('does nothing before the day it is due', async () => {
    const { db, env } = register();
    await seedTestData(env, 'u1');
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,'15',?)`)
      .run(AUTO_RESET_DAYS, AT);
    expect(await autoResetIfDue(env)).toBe(null);
  });

  it('puts the caseload back once the days have passed', async () => {
    const { db, count, env } = register();
    await seedTestData(env, 'u1');
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,'15',?)`)
      .run(AUTO_RESET_DAYS, AT);
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, is_test, created_at, updated_at)
                VALUES ('mine','CL-8001','individual','Added while trying it','active',1,?,?)`)
      .run(AT, AT);
    db.prepare(`UPDATE settings SET value = '2020-01-01T00:00:00.000Z' WHERE key = ?`).run(SEEDED_AT);

    const result = await autoResetIfDue(env);
    expect(result).not.toBe(null);
    expect(count(`SELECT COUNT(*) AS n FROM clients WHERE id = 'mine'`)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM clients')).toBe(result!.clients);
  });

  it('says when it is due, so the screen can show it', async () => {
    const { db, env } = register();
    await seedTestData(env, 'u1');
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,'15',?)`)
      .run(AUTO_RESET_DAYS, AT);
    const state = await seedState(env);
    expect(state.autoResetDays).toBe(15);
    expect(state.seededAt).toBeTruthy();
    expect(Date.parse(state.dueAt!) - Date.parse(state.seededAt!)).toBe(15 * 86_400_000);
  });

  it('defaults to zero in the setting an administrator sees', () => {
    const admin = readFileSync('src/modules/admin/index.ts', 'utf8');
    expect(admin).toContain("key: 'testdata.auto_reset_days'");
    expect(admin).toMatch(/testdata\.auto_reset_days[\s\S]{0,200}default: '0'/);
  });

  it('is checked by the nightly pass', () => {
    const index = readFileSync('src/index.ts', 'utf8');
    expect(index).toContain('autoResetIfDue(env)');
  });
});

describe('nothing in the caseload came from a real file', () => {
  it('every invented address is on a domain that cannot receive mail', () => {
    // `.test` is reserved by the IANA and resolves nowhere. A seeded quotation
    // emailed by somebody learning the register must not reach a person.
    const seed = readFileSync('src/core/testseed.ts', 'utf8');
    const addresses = seed.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(10);
    for (const address of addresses) {
      expect(address, address).toMatch(/@[\w.-]*example\.test$/);
    }
  });
});

describe('the caseload somebody trying the register is shown', () => {
  // **Asked for on 12 September 2026:** *"give it 20 cases, varied, with people
  // from different countries, make 5 simple ones and 10 complicated and 5
  // unusual applications."* The mix is the point: a caseload of twenty
  // straightforward visitor visas would tell a prospective customer nothing
  // about whether the register can hold their actual work.

  it('is twenty matters', async () => {
    const { env, count } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM cases')).toBe(20);
    expect(env).toBeTruthy();
  });

  it('names only case types the practice’s own vocabulary carries', async () => {
    // **This was broken, and it was the first thing a visitor would have seen.**
    // Six of the twelve types the old caseload used — `advice_general`,
    // `other_s61`, `rv_skilled` among them — are not in `core/vocabulary.ts`,
    // so those matters displayed a raw key where every other matter shows a
    // label. Checked here against the real vocabulary rather than a copy of it.
    // **And this check was too loose to catch the second one.** It harvested
    // every `key | Label` line in the whole file, so a key belonging to a
    // *different* vocabulary passed: the seed gave a student matter the type
    // `sv_student`, which is a visa a client **holds**, not a kind of work the
    // practice does. The case-type list has `sv_general` for that. Spotted by
    // the practice on 12 September 2026 in the trial's Type column, one day
    // after this test was written to prevent exactly this.
    //
    // So read the case-type vocabulary itself, not the file it lives in.
    const { rows } = await seeded();
    const caseTypeBlock = VOCABULARY_SOURCE.match(
      /export const CASE_TYPE_VOCAB[\s\S]*?defaults: `([\s\S]*?)`,/)?.[1];
    expect(caseTypeBlock, 'the case type vocabulary could not be read').toBeTruthy();
    const configured = new Set(
      [...caseTypeBlock!.matchAll(/^([a-z][a-z_0-9]*) \|/gm)].map((m) => m[1]!));
    // If the block ever stops being found, the set is empty and every type
    // "fails" — loud, not silent. Check it read something sane.
    expect(configured.size).toBeGreaterThan(40);
    const used = rows<{ case_type: string }>('SELECT DISTINCT case_type FROM cases')
      .map((r) => r.case_type);
    expect(used.length).toBeGreaterThan(12);
    for (const type of used) {
      expect(configured.has(type), `${type} is not in the practice's case types`).toBe(true);
    }
  });

  it('spreads across many kinds of work rather than repeating one', async () => {
    const { count } = await seeded();
    expect(count('SELECT COUNT(DISTINCT case_type) AS n FROM cases')).toBeGreaterThanOrEqual(15);
  });

  it('carries the hard ones, not only the easy ones', async () => {
    // The five unusual matters, each by its type. A caseload without these is a
    // caseload that does not show what the practice is chosen for.
    const { count } = await seeded();
    for (const type of ['rq_section_61_request', 'rq_ministerial_intervention',
                        'rq_reconsideration_temporary_visa_decline',
                        'reply_deportation_liability_response']) {
      expect(count(`SELECT COUNT(*) AS n FROM cases WHERE case_type = '${type}'`), type)
        .toBeGreaterThan(0);
    }
  });

  it('has something declined, with the clock still running on it', async () => {
    // A caseload where everything was granted is not one anybody will
    // recognise, and a decline with a live deadline on it is the state a
    // register is most needed in.
    const { count } = await seeded();
    expect(count(`SELECT COUNT(*) AS n FROM cases WHERE status = 'declined'`))
      .toBeGreaterThanOrEqual(2);
    expect(count(`SELECT COUNT(*) AS n FROM cases
                   WHERE status = 'declined' AND next_action_due IS NOT NULL`))
      .toBeGreaterThan(0);
  });

  it('puts a history on a file rather than one matter each', async () => {
    // Eleven files carry the twenty. A client's file with a single matter on it
    // shows none of what the register is for: the matter that was declined
    // before the one that was granted, the visa that ran out while something
    // else was being decided.
    const { rows } = await seeded();
    const perFile = rows<{ n: number }>(
      'SELECT COUNT(*) AS n FROM cases GROUP BY client_id').map((r) => r.n);
    expect(perFile.filter((n) => n >= 2).length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...perFile)).toBeGreaterThanOrEqual(3);
  });

  it('is people from many countries', async () => {
    const { count } = await seeded();
    expect(count(`SELECT COUNT(DISTINCT code) AS n FROM client_nationalities`))
      .toBeGreaterThanOrEqual(12);
  });
});
