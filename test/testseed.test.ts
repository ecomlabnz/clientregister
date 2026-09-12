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
import { CASE_STATUSES, PARTY_ROLES, PRIORITIES, QUOTE_STATUSES } from '../src/domain';
import { KB_STATUSES } from '../src/core/kb';

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
  it('is thirty-odd files with matters and quotations on them', async () => {
    const { env, count } = register();
    const result = await seedTestData(env, 'u1');
    expect(result.clients).toBeGreaterThanOrEqual(30);
    expect(result.cases).toBe(35);
    expect(result.quotes).toBeGreaterThanOrEqual(35);
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
    expect(busy.length).toBeGreaterThanOrEqual(10);
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
    expect(byTable.clients).toBeGreaterThanOrEqual(30);
    expect(byTable.cases).toBe(35);
    expect(byTable.quotes).toBeGreaterThanOrEqual(35);
    expect(byTable.invoices).toBeGreaterThanOrEqual(5);
    expect(byTable.kb_articles).toBeGreaterThanOrEqual(6);
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

  it('is thirty-five matters', async () => {
    const { env, count } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM cases')).toBe(35);
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
    expect(count('SELECT COUNT(DISTINCT case_type) AS n FROM cases')).toBeGreaterThanOrEqual(20);
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
    // Twenty files carry the thirty-five. A file with a single matter on it
    // shows none of what the register is for: the matter that was declined
    // before the one that was granted, the visa that ran out while something
    // else was being decided.
    const { rows } = await seeded();
    const perFile = rows<{ n: number }>(
      'SELECT COUNT(*) AS n FROM cases GROUP BY client_id').map((r) => r.n);
    expect(perFile.filter((n) => n >= 2).length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...perFile)).toBeGreaterThanOrEqual(3);
  });

  it('is people from many countries', async () => {
    const { count } = await seeded();
    expect(count(`SELECT COUNT(DISTINCT code) AS n FROM client_nationalities`))
      .toBeGreaterThanOrEqual(12);
  });
});

/**
 * The people on a matter.
 *
 * **Reported by the practice on 12 September 2026:** *"partners and children do
 * not appear on the matters they belong to."* They did not. Four matters out of
 * twenty carried a party row; everybody else's partner and children existed as
 * clients of their own and appeared nowhere, so opening a matter showed the
 * principal applicant and an empty Parties list.
 *
 * The worst of it was a **partnership** residence application that named no
 * partner at all, which is not a thin file — it is not an application. That is
 * the rule pinned below: pinned as a rule and not as that one matter, because
 * the next partnership application somebody adds would otherwise be free to
 * repeat it.
 */
describe('everybody who belongs on a matter is named on it', () => {
  /**
   * The roles that can stand for "the other half of the relationship".
   *
   * Three rather than one, because which of them is right depends on what is
   * being applied for. On a partnership residence the partner supports and does
   * not apply — `supporting_partner`. On a partner-of-a-worker visa the partner
   * *is* the applicant and the worker is the `partner`. On a residence
   * application filed for two people the partner is a `secondary_applicant`.
   * What is never right is nobody at all.
   */
  const PARTNERISH = ['partner', 'supporting_partner', 'secondary_applicant'];

  it('a partnership-based matter names a partner', async () => {
    const { rows } = await seeded();
    const matters = rows<{ id: string; ref: string; title: string; case_type: string }>(
      'SELECT id, ref, title, case_type FROM cases');
    const parties = rows<{ case_id: string; role: string }>(
      'SELECT case_id, role FROM case_parties');

    // Derived, not listed: anything whose type or title says partnership.
    const partnership = matters.filter(
      (m) => /partner/i.test(m.case_type) || /partner/i.test(m.title));
    // The vacuity guard. A filter that matched nothing would make the loop
    // below pass while saying nothing at all.
    expect(partnership.length, 'no partnership matter was found to check')
      .toBeGreaterThanOrEqual(3);

    for (const m of partnership) {
      const named = parties.filter(
        (p) => p.case_id === m.id && PARTNERISH.includes(p.role));
      expect(named.length, `${m.ref} “${m.title}” names no partner`).toBeGreaterThan(0);
    }
  });

  it('links people to matters in numbers, not as a token four', async () => {
    // The floor is set well above what was there when this was reported, so
    // that quietly dropping the party rows again fails rather than passes.
    const { count, rows } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM case_parties')).toBeGreaterThanOrEqual(24);
    const roles = new Set(
      rows<{ role: string }>('SELECT DISTINCT role FROM case_parties').map((r) => r.role));
    expect(roles.size, 'the caseload uses too few of the roles').toBeGreaterThanOrEqual(7);
    for (const role of ['principal_applicant', 'supporting_partner', 'dependent_child',
                        'employer', 'sponsor']) {
      expect(roles, role).toContain(role);
    }
  });

  it('names only roles the register has', async () => {
    const { rows } = await seeded();
    const used = rows<{ role: string }>('SELECT DISTINCT role FROM case_parties')
      .map((r) => r.role);
    for (const role of used) {
      expect(PARTY_ROLES as readonly string[], `${role} is not a party role`).toContain(role);
    }
  });

  it('puts every organisation on at least one matter', async () => {
    // A company on the register that appears on nothing is a row with no reason
    // to exist. Each of these is either the client of its own accreditation or
    // job check, or the employer named on somebody's work visa — which is the
    // whole point of a role living on the link rather than on the client.
    const { rows } = await seeded();
    const orphans = rows<{ full_name: string }>(
      `SELECT full_name FROM clients c
        WHERE c.kind = 'organisation'
          AND NOT EXISTS (SELECT 1 FROM cases k WHERE k.client_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM case_parties p WHERE p.client_id = c.id)`);
    expect(orphans.map((o) => o.full_name)).toEqual([]);
    expect(rows<{ n: number }>(
      `SELECT COUNT(*) AS n FROM clients WHERE kind = 'organisation'`)[0]!.n)
      .toBeGreaterThanOrEqual(4);
  });

  it('leaves a few clients attached to nothing, deliberately', async () => {
    // Not every client has live work, and a caseload where every one of them
    // does shows nothing of what the Leads list is for. What must not happen is
    // a *partner or child* who is nowhere, which the test above covers.
    const { rows } = await seeded();
    const idle = rows<{ full_name: string }>(
      `SELECT full_name FROM clients c
        WHERE NOT EXISTS (SELECT 1 FROM cases k WHERE k.client_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM case_parties p WHERE p.client_id = c.id)`);
    expect(idle.length).toBeGreaterThan(0);
    expect(idle.length, 'too many clients are attached to nothing').toBeLessThanOrEqual(3);
  });
});

/**
 * Every value in the caseload comes from the list it belongs to.
 *
 * Three invented keys shipped on the morning of 12 September and the practice
 * found them on the Cases list. `sv_student` was the instructive one: a real
 * key, from the wrong vocabulary. So each field is checked against **its own**
 * list here rather than against "somewhere in the vocabulary file", which is
 * what let that one through.
 */
describe('nothing in the caseload is a key somebody made up', () => {
  /** One vocabulary's default keys, read out of `core/vocabulary.ts` itself. */
  function vocabKeys(name: string): Set<string> {
    const block = VOCABULARY_SOURCE.match(
      new RegExp(`export const ${name}[\\s\\S]*?defaults: \`([\\s\\S]*?)\`,`))?.[1];
    expect(block, `${name} could not be read`).toBeTruthy();
    const keys = new Set([...block!.matchAll(/^([a-z][a-z_0-9]*) \|/gm)].map((m) => m[1]!));
    expect(keys.size, `${name} read as empty`).toBeGreaterThan(2);
    return keys;
  }

  const CHECKS: Array<[string, string, string]> = [
    // [vocabulary, table, column]
    ['VISA_TYPE_VOCAB', 'clients', 'current_visa_type'],
    ['FLAG_KIND_VOCAB', 'flags', 'kind'],
    ['EMPLOYMENT_KIND_VOCAB', 'client_employment', 'kind'],
    ['TRAVEL_PURPOSE_VOCAB', 'client_travel', 'purpose'],
    ['EDUCATION_LEVEL_VOCAB', 'client_education', 'level'],
  ];

  it.each(CHECKS)('every %s value in %s.%s is one the list carries', async (vocab, table, column) => {
    const { rows } = await seeded();
    const configured = vocabKeys(vocab);
    const used = rows<{ v: string }>(
      `SELECT DISTINCT ${column} AS v FROM ${table} WHERE ${column} IS NOT NULL`)
      .map((r) => r.v);
    expect(used.length, `nothing was written to ${table}.${column}`).toBeGreaterThan(0);
    for (const value of used) {
      expect(configured.has(value), `${value} is not in ${vocab}`).toBe(true);
    }
  });

  it('gives every matter a priority the register has', async () => {
    const { rows } = await seeded();
    for (const { priority } of rows<{ priority: string }>(
      'SELECT DISTINCT priority FROM cases')) {
      expect(PRIORITIES as readonly string[], priority).toContain(priority);
    }
  });
});

/**
 * Money, and the histories that make the register worth looking at.
 *
 * **Asked for on 12 September 2026:** *"i do not see any invoices in trial data
 * - please introduce say 5-7 invoices with various stages. also the same for
 * quotes - increase number of quotes to the number of actual cases as one would
 * think that a case once started with a quotation"*, and *"the principal
 * clients should have varied employment, education and travel histories."*
 */
describe('the money and the histories', () => {
  it('lays down invoices at more than one stage', async () => {
    const { rows, count } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM invoices')).toBeGreaterThanOrEqual(5);
    const statuses = new Set(
      rows<{ status: string }>('SELECT DISTINCT status FROM invoices').map((r) => r.status));
    for (const s of statuses) {
      expect(['draft', 'issued', 'part_paid', 'paid', 'void'], `${s} is not an invoice status`)
        .toContain(s);
    }
    expect(statuses.size, 'the invoices are all in one state').toBeGreaterThanOrEqual(4);
    expect(statuses).toContain('paid');
    expect(statuses).toContain('part_paid');
  });

  it('has one invoice already past its due date, and one not', async () => {
    // Overdue is a date and not a status, which is the distinction the Money
    // page has to make and the one a caseload has to be able to show.
    const { rows } = await seeded();
    const owing = rows<{ due_on: string }>(
      `SELECT due_on FROM invoices WHERE status IN ('issued', 'part_paid') AND due_on IS NOT NULL`);
    const today = new Date().toISOString().slice(0, 10);
    expect(owing.some((i) => i.due_on < today), 'nothing is overdue').toBe(true);
    expect(owing.some((i) => i.due_on >= today), 'everything is overdue').toBe(true);
  });

  it('adds up: an invoice agrees with its own lines', async () => {
    // The one page where being a cent out matters. Checked by adding the lines
    // up in SQL rather than by trusting the figure the seed wrote.
    const { rows } = await seeded();
    const wrong = rows<{ ref: string }>(
      `SELECT i.ref FROM invoices i JOIN invoice_items li ON li.invoice_id = i.id
        GROUP BY i.id
       HAVING i.net_cents   != SUM(li.net_cents)
           OR i.gst_cents   != SUM(li.gst_cents)
           OR i.gross_cents != SUM(li.gross_cents)`);
    expect(wrong.map((r) => r.ref)).toEqual([]);
  });

  it('adds up: a quotation agrees with its own lines', async () => {
    const { rows } = await seeded();
    const wrong = rows<{ ref: string }>(
      `SELECT q.ref FROM quotes q JOIN quote_items qi ON qi.quote_id = q.id
        GROUP BY q.id
       HAVING q.amount_cents + q.gst_cents + q.disbursements_cents != SUM(qi.gross_cents)`);
    expect(wrong.map((r) => r.ref)).toEqual([]);
  });

  it('says an invoice is paid only when the payments come to the total', async () => {
    const { rows } = await seeded();
    const lying = rows<{ ref: string; status: string; paid: number; gross: number }>(
      `SELECT ref, status, paid_cents AS paid, gross_cents AS gross FROM invoices
        WHERE status IN ('paid', 'part_paid', 'issued')`)
      .filter((i) => (i.status === 'paid' && i.paid < i.gross)
                  || (i.status === 'part_paid' && (i.paid <= 0 || i.paid >= i.gross))
                  || (i.status === 'issued' && i.paid !== 0));
    expect(lying.map((i) => i.ref)).toEqual([]);
  });

  it('records the payments behind what it says has been paid', async () => {
    const { rows } = await seeded();
    const mismatched = rows<{ ref: string }>(
      `SELECT i.ref FROM invoices i
        WHERE i.paid_cents !=
          (SELECT COALESCE(SUM(p.amount_cents), 0) FROM invoice_payments p
            WHERE p.invoice_id = i.id)`);
    expect(mismatched.map((r) => r.ref)).toEqual([]);
  });

  it('starts very nearly every matter with a quotation', async () => {
    // *"a case once started with a quotation."* Not every one: a handful are
    // covered by another matter's quotation, or were done at no charge, and
    // those are named in the seed with the reason. The rule is that the
    // exceptions stay a handful.
    const { count } = await seeded();
    const matters = count('SELECT COUNT(*) AS n FROM cases');
    const quoted = count(
      'SELECT COUNT(DISTINCT case_id) AS n FROM quotes WHERE case_id IS NOT NULL');
    expect(matters - quoted, 'too many matters have no quotation on them')
      .toBeLessThanOrEqual(4);
    expect(count('SELECT COUNT(*) AS n FROM quotes')).toBeGreaterThanOrEqual(matters - 4);
  });

  it('does not make every quotation an accepted one', async () => {
    const { rows } = await seeded();
    const byStatus = rows<{ status: string; n: number }>(
      'SELECT status, COUNT(*) AS n FROM quotes GROUP BY status');
    expect(byStatus.length, 'the quotations are all in one state').toBeGreaterThanOrEqual(4);
    for (const { status } of byStatus) {
      expect(QUOTE_STATUSES as readonly string[], status).toContain(status);
    }
    for (const s of ['accepted', 'sent', 'declined', 'draft']) {
      expect(byStatus.map((r) => r.status), s).toContain(s);
    }
  });

  it('keeps a quotation on the matter it belongs to', async () => {
    // The database refuses a quotation whose matter belongs to somebody else,
    // and it refused two of these while they were being written. Checked again
    // here because the refusal is silent once the data is right.
    const { rows } = await seeded();
    const wrong = rows<{ ref: string }>(
      `SELECT q.ref FROM quotes q JOIN cases k ON k.id = q.case_id
        WHERE q.client_id IS NOT k.client_id`);
    expect(wrong.map((r) => r.ref)).toEqual([]);
  });

  it('gives the principal clients histories worth looking at', async () => {
    const { count } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM client_employment')).toBeGreaterThanOrEqual(50);
    expect(count('SELECT COUNT(*) AS n FROM client_education')).toBeGreaterThanOrEqual(25);
    expect(count('SELECT COUNT(*) AS n FROM client_travel')).toBeGreaterThanOrEqual(25);
    // Everybody who holds a matter has a working life on file.
    expect(count(
      `SELECT COUNT(*) AS n FROM clients c
        WHERE c.kind = 'individual'
          AND EXISTS (SELECT 1 FROM cases k WHERE k.client_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM client_employment e WHERE e.client_id = c.id)`))
      .toBe(0);
  });

  it('plants gaps in the employment histories, on more than one file', async () => {
    // The register marks a period nobody has accounted for. A caseload with no
    // gaps in it shows that doing nothing.
    const { count } = await seeded();
    expect(count(
      `SELECT COUNT(DISTINCT client_id) AS n FROM client_employment
        WHERE kind IN ('unemployed', 'caring')`)).toBeGreaterThanOrEqual(5);
  });

  it('writes history dates at all three precisions', async () => {
    // A history date may be a whole day, a month or a year — 0091 allowed the
    // first two, 0095 added the third. A caseload that wrote every one of them
    // in full would never show the shorter forms work at all.
    const { count } = await seeded();
    for (const [precision, length] of [['a day', 10], ['a month', 7], ['a year', 4]] as const) {
      expect(count(
        `SELECT COUNT(*) AS n FROM client_employment WHERE LENGTH(started_on) = ${length}`),
        `no employment date is written as ${precision}`).toBeGreaterThan(0);
    }
    // And on a trip, which is a different table with its own guard.
    expect(count('SELECT COUNT(*) AS n FROM client_travel WHERE LENGTH(started_on) = 4'))
      .toBeGreaterThan(0);
  });

  it('records when a qualification was awarded, not only when study ended', async () => {
    // The date an application asks for, and it is usually months after the
    // last exam. It had nowhere to go until migration 0095.
    const { count, rows } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM client_education WHERE awarded_on IS NOT NULL'))
      .toBeGreaterThanOrEqual(20);
    // Conferred after the study finished, never before it.
    const backwards = rows<{ institution: string }>(
      `SELECT institution FROM client_education
        WHERE awarded_on IS NOT NULL AND ended_on IS NOT NULL
          AND SUBSTR(awarded_on, 1, 4) < SUBSTR(ended_on, 1, 4)`);
    expect(backwards.map((r) => r.institution)).toEqual([]);
  });

  it('gives a qualification a level on the framework, or says it has none', async () => {
    // `nzqcf_7` carries the level in the key. `secondary` and
    // `overseas_unassessed` are the two honest answers for a qualification that
    // has no framework level, and both have to appear or the caseload is only
    // showing half the list.
    const { rows } = await seeded();
    const levels = new Set(
      rows<{ level: string }>(
        'SELECT DISTINCT level FROM client_education WHERE level IS NOT NULL')
        .map((r) => r.level));
    expect(levels.size, 'too few education levels are used').toBeGreaterThanOrEqual(5);
    expect([...levels].filter((l) => /^nzqcf_\d+$/.test(l)).length).toBeGreaterThanOrEqual(3);
    expect(levels).toContain('secondary');
    expect(levels).toContain('overseas_unassessed');
  });
});

/**
 * The knowledge base.
 *
 * **Asked for on 12 September 2026:** *"add some sample entries into the
 * knowledge base to showcase it - all these data in the trial register will be
 * there by default as a starting point for people to play with."*
 */
describe('the knowledge base is not an empty page', () => {
  it('holds a handful of articles', async () => {
    const { count } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM kb_articles')).toBeGreaterThanOrEqual(6);
  });

  it('uses only kinds and statuses the knowledge base defines', async () => {
    const { rows } = await seeded();
    const source = readFileSync('src/core/kb.ts', 'utf8');
    const defaults = source.match(/const DEFAULT_KINDS = \[([\s\S]*?)\]\.join/)?.[1];
    expect(defaults, 'the knowledge base kinds could not be read').toBeTruthy();
    const configured = new Set(
      [...defaults!.matchAll(/'([a-z][a-z_0-9]*) \|/g)].map((m) => m[1]!));
    expect(configured.size).toBeGreaterThan(5);

    const used = rows<{ kind: string }>('SELECT DISTINCT kind FROM kb_articles');
    expect(used.length).toBeGreaterThanOrEqual(4);
    for (const { kind } of used) {
      expect(configured.has(kind), `${kind} is not a knowledge base kind`).toBe(true);
    }
    for (const { status } of rows<{ status: string }>('SELECT DISTINCT status FROM kb_articles')) {
      expect(KB_STATUSES as readonly string[], status).toContain(status);
    }
  });

  it('shares at least one with a client, so the link has something to open', async () => {
    const { rows, count } = await seeded();
    expect(count('SELECT COUNT(*) AS n FROM kb_articles WHERE share_token IS NOT NULL'))
      .toBeGreaterThan(0);
    // The database insists a shared article says who shared it and when.
    const half = rows<{ ref: string }>(
      `SELECT ref FROM kb_articles
        WHERE (share_token IS NULL) != (shared_at IS NULL)
           OR (share_token IS NOT NULL AND shared_by IS NULL)`);
    expect(half.map((r) => r.ref)).toEqual([]);
  });

  it('says in each one that it is a demonstration, not advice', async () => {
    // These sit in a register somebody is being sold. Nothing in them may read
    // as something a person could act on.
    const { rows } = await seeded();
    const bodies = rows<{ ref: string; body: string }>('SELECT ref, body FROM kb_articles');
    expect(bodies.length).toBeGreaterThan(0);
    for (const a of bodies) {
      expect(a.body.toLowerCase(), `${a.ref} does not say it is a demonstration`)
        .toContain('demonstration note');
    }
  });

  it('goes with the rest of the caseload when it is put back', async () => {
    // A knowledge base article could not be marked as test data at all until
    // migration 0096, so a reset would have laid down a second copy of every
    // one of them every time it ran.
    const { env } = await seeded();
    await purgeTestData(env, 'u1');
    const after = await seedTestData(env, 'u1');
    expect(after.articles).toBeGreaterThan(0);
  });
});
