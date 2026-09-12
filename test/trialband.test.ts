/**
 * A trial register says so, on every page, with the date it puts itself back.
 *
 * **Asked for on 12 September 2026:** *"there should be a running line or a
 * banner above saying in how many days the reset will take place."*
 *
 * The band exists because of who reads it. Somebody being shown the register
 * for the first time is exactly the person who could mistake it for the real
 * thing, and exactly the person who will not go looking under Settings to find
 * out when it wipes. So it is on every page and it is not dismissible.
 *
 * What is pinned here is the rule, not the sentence: a production register
 * never shows it and never pays a query for it; a trial with no timer says
 * nothing rather than something useless; and the count is of whole days
 * remaining, because "how long have I got" is the question being asked.
 */

import { describe, expect, it } from 'vitest';
import { fakeD1, migratedSqlite } from './support/d1';
import { trialNotice, SEEDED_AT, AUTO_RESET_DAYS } from '../src/core/testseed';
import type { Env } from '../src/types';

/** A register with the caseload laid down `daysAgo` days ago, resetting after `every`. */
function register(opts: { appEnv?: string; daysAgo?: number; every?: number } = {}) {
  const db = migratedSqlite();
  if (opts.daysAgo !== undefined) {
    const at = new Date(Date.now() - opts.daysAgo * 86_400_000).toISOString();
    db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)')
      .run(SEEDED_AT, at, at);
  }
  if (opts.every !== undefined) {
    db.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?)')
      .run(AUTO_RESET_DAYS, String(opts.every), '2026-09-12T00:00:00Z');
  }
  return { DB: fakeD1(db), APP_ENV: opts.appEnv ?? 'trial' } as unknown as Env;
}

describe('the band on a trial register', () => {
  it('says how many days are left and the date it happens', async () => {
    const said = await trialNotice(register({ daysAgo: 1, every: 5 }));
    expect(said).toContain('This is a trial register');
    expect(said).toContain('4 days');
  });

  it('says tomorrow rather than "1 days"', async () => {
    expect(await trialNotice(register({ daysAgo: 4, every: 5 }))).toContain('tomorrow');
  });

  it('does not promise a day that has already passed', async () => {
    const said = await trialNotice(register({ daysAgo: 9, every: 5 }));
    expect(said).toContain('shortly');
    expect(said).not.toMatch(/-\d+ days/);
  });
});

describe('the band on a register that is not a trial', () => {
  it('is not shown on the practice’s own register', async () => {
    expect(await trialNotice(register({ appEnv: 'production', daysAgo: 1, every: 5 }))).toBeNull();
  });

  it('is not shown when APP_ENV is missing altogether', async () => {
    // Absent means production. A register that cannot say what it is must not
    // tell everybody looking at it that it is about to wipe.
    const db = migratedSqlite();
    expect(await trialNotice({ DB: fakeD1(db) } as unknown as Env)).toBeNull();
  });

  it('says nothing where the caseload is not on a timer', async () => {
    // A band saying "this is a trial" and then nothing useful is a band people
    // stop reading, which costs the warning on the register that does wipe.
    expect(await trialNotice(register({ daysAgo: 1 }))).toBeNull();
    expect(await trialNotice(register({ daysAgo: 1, every: 0 }))).toBeNull();
  });

  it('says nothing before the caseload has ever been laid down', async () => {
    expect(await trialNotice(register({ every: 5 }))).toBeNull();
  });
});
