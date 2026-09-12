/**
 * The shared demonstration account, attacked directly.
 *
 * **Asked for on 12 September 2026:** an account in the trial register that
 * members of the public can sign in to, with the password published.
 *
 * A published password turns five ordinary, correct features into ways for one
 * visitor to take a public account away from everybody else. Each of the five
 * was read in the code before anything was built, and each is proved here:
 *
 *  1. `POST /account/password` lets the signed-in person change the password.
 *  2. `POST /account/2fa/enable` lets them attach their own authenticator.
 *  3. Neither is undone by the ten-day reset — it covers `TEST_TABLES`, and
 *     `users` is not one of them. So 1 and 2 are permanent.
 *  4. Five bad attempts lock the account for up to thirty minutes, and on a
 *     published password anybody can do that at will, protecting nothing.
 *  5. `mail:send` reaches strangers. A public account that can send from the
 *     register's address is an open relay.
 *
 * The database guarantees are attacked with raw SQL against a database built
 * from the migrations — never through a route — because that is the only way
 * to test a rule that is supposed to hold whoever is writing. Every trigger is
 * then **mutation-tested**: dropped, the bad write fired again and shown to
 * land, restored, and shown to be refused again. A guard nobody proved can
 * fail is not a guard.
 *
 * No password, hash or credential of the real demonstration account appears
 * here. The account itself is created by hand in the live trial database.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fakeD1, fakeUser, migratedSqlite, mountModule } from './support/d1';
import { authenticate } from '../src/core/auth';
import { hashPassword } from '../src/core/crypto';
import { can, ROLE_PERMISSIONS, type Permission } from '../src/core/rbac';
import { verifyUploadToken, createUploadToken } from '../src/core/uploadtokens';
import { authModule } from '../src/modules/auth';
import { adminModule } from '../src/modules/admin';
import { TEST_TABLES } from '../src/core/testdata';

type Db = ReturnType<typeof migratedSqlite>;

const AT = '2026-09-12T09:00:00Z';
const MIGRATION = 'migrations/0103_a_demonstration_account_cannot_change_its_own_sign_in.sql';

/** The demonstration account as it will actually exist: marked, and no more. */
function seedDemo(d: Db, over: Partial<Record<string, string | number>> = {}): void {
  const row = {
    id: 'U_DEMO', email: 'demo@example.test', name: 'Demonstration',
    password_hash: 'not-a-real-hash', role: 'adviser', status: 'active', is_demo: 1, ...over,
  };
  d.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(row.id, row.email, row.name, row.password_hash, row.role, row.status, row.is_demo, AT, AT);
}

function seedOrdinary(d: Db, id = 'U_REAL'): void {
  d.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
     VALUES (?,?,?,?,?,?,0,?,?)`,
  ).run(id, `${id}@example.test`, 'Somebody', 'h', 'adviser', 'active', AT, AT);
}

/**
 * Every refusal this migration installs: the trigger that does the work, the
 * write it must refuse, and the words it must refuse with.
 *
 * This table is the specification. A trigger added to the migration and not to
 * this list fails the count assertion at the bottom, and every row here is
 * mutation-tested below.
 */
const REFUSALS: Array<{
  trigger: string;
  what: string;
  seed?: (d: Db) => void;
  attack: (d: Db) => void;
  says: RegExp;
}> = [
  {
    trigger: 'demo_password_cannot_change',
    what: 'the password cannot be changed',
    attack: (d) => d.exec(`UPDATE users SET password_hash = 'somebody-elses' WHERE id = 'U_DEMO'`),
    says: /shared demonstration account.*sign-in cannot be changed/s,
  },
  {
    trigger: 'demo_email_cannot_change',
    what: 'the address cannot be changed',
    attack: (d) => d.exec(`UPDATE users SET email = 'mine@example.test' WHERE id = 'U_DEMO'`),
    says: /shared demonstration account.*sign-in cannot be changed/s,
  },
  {
    trigger: 'demo_totp_secret_cannot_change',
    what: 'an authenticator cannot be attached',
    attack: (d) => d.exec(`UPDATE users SET totp_secret = 'MYSECRET' WHERE id = 'U_DEMO'`),
    says: /shared demonstration account.*sign-in cannot be changed/s,
  },
  {
    trigger: 'demo_totp_enabled_cannot_change',
    what: 'two-factor cannot be switched on',
    attack: (d) => d.exec(`UPDATE users SET totp_enabled = 1 WHERE id = 'U_DEMO'`),
    says: /shared demonstration account.*sign-in cannot be changed/s,
  },
  {
    trigger: 'demo_role_cannot_change',
    what: 'the role cannot be changed',
    attack: (d) => d.exec(`UPDATE users SET role = 'readonly' WHERE id = 'U_DEMO'`),
    says: /shared demonstration account.*sign-in cannot be changed/s,
  },
  {
    trigger: 'demo_status_cannot_change',
    what: 'it cannot be suspended',
    attack: (d) => d.exec(`UPDATE users SET status = 'suspended' WHERE id = 'U_DEMO'`),
    says: /shared demonstration account.*sign-in cannot be changed/s,
  },
  {
    trigger: 'demo_account_is_never_privileged_on_insert',
    what: 'it cannot be born an administrator',
    seed: () => {},
    attack: (d) => d.exec(
      `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
       VALUES ('U_BAD','bad@example.test','B','h','admin','active',1,'${AT}','${AT}')`),
    says: /cannot be an owner or an administrator/,
  },
  {
    trigger: 'demo_account_is_never_privileged_on_update',
    what: 'an administrator cannot be turned into one',
    seed: (d) => d.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
       VALUES ('U_ADMIN','admin@example.test','A','h','admin','active',0,?,?)`).run(AT, AT),
    attack: (d) => d.exec(`UPDATE users SET is_demo = 1 WHERE id = 'U_ADMIN'`),
    says: /cannot be an owner or an administrator/,
  },
];

describe('the database refuses to let the demonstration account change its sign-in', () => {
  for (const r of REFUSALS) {
    it(r.what, () => {
      const d = migratedSqlite();
      (r.seed ?? seedDemo)(d);
      expect(() => r.attack(d)).toThrow(r.says);
    });
  }
});

/**
 * Removing a guard has to be visible.
 *
 * Each trigger is dropped, its write fired again and required to *land*, then
 * the trigger is put back from the migration file and the write required to be
 * refused again. This is the check that says the refusals above come from the
 * triggers rather than from something else in the schema.
 */
describe('every trigger is mutation-tested', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  /** The `CREATE TRIGGER ... END;` block for one name, read from the migration. */
  function definitionOf(name: string): string {
    const start = sql.indexOf(`CREATE TRIGGER ${name}\n`);
    expect(start, `${name} is not in ${MIGRATION}`).toBeGreaterThan(-1);
    const end = sql.indexOf('\nEND;', start);
    expect(end, `${name} has no END`).toBeGreaterThan(start);
    return sql.slice(start, end + '\nEND;'.length);
  }

  for (const r of REFUSALS) {
    it(`${r.trigger} is the thing doing the refusing`, () => {
      const d = migratedSqlite();
      (r.seed ?? seedDemo)(d);

      d.exec(`DROP TRIGGER ${r.trigger};`);
      expect(() => r.attack(d), 'the bad write must land once the trigger is gone').not.toThrow();

      // Restored on the *same* database, so what is proved is the trigger
      // going away and coming back rather than two different databases. The
      // rows are put back first: the write that just landed changed the row
      // the trigger reads.
      d.exec('DELETE FROM users;');
      (r.seed ?? seedDemo)(d);
      d.exec(definitionOf(r.trigger));
      expect(() => r.attack(d)).toThrow(r.says);
    });
  }

  it('covers every trigger the migration installs, and no more', () => {
    const installed = [...sql.matchAll(/CREATE TRIGGER (\w+)/g)].map((m) => m[1]).sort();
    expect(installed).toEqual(REFUSALS.map((r) => r.trigger).sort());
    expect(installed).toHaveLength(8);
  });
});

describe('what the demonstration account may still do', () => {
  it('can be renamed, because a name is not a way in', () => {
    const d = migratedSqlite();
    seedDemo(d);
    expect(() => d.exec(`UPDATE users SET name = 'The demonstration' WHERE id = 'U_DEMO'`)).not.toThrow();
  });

  it('survives a whole-row save that changes only the name', () => {
    // This is the statement Settings → People actually runs. Every guarded
    // column is named in the SET clause and set to what it already holds, so
    // the `IS NOT` in each trigger is what makes a rename possible at all.
    const d = migratedSqlite();
    seedDemo(d);
    expect(() => d.exec(
      `UPDATE users SET name = 'Renamed', email = 'demo@example.test', role = 'adviser',
              status = 'active', updated_at = '${AT}' WHERE id = 'U_DEMO'`)).not.toThrow();
    expect(d.prepare(`SELECT name FROM users WHERE id = 'U_DEMO'`).get()).toMatchObject({ name: 'Renamed' });
  });

  it('can be deleted — an administrator must be able to withdraw the demonstration', () => {
    const d = migratedSqlite();
    seedDemo(d);
    expect(() => d.exec(`DELETE FROM users WHERE id = 'U_DEMO'`)).not.toThrow();
    expect(d.prepare(`SELECT COUNT(*) AS n FROM users`).get()).toMatchObject({ n: 0 });
  });

  it('can have the mark taken off, which is how it stops being a demonstration', () => {
    const d = migratedSqlite();
    seedDemo(d);
    expect(() => d.exec(`UPDATE users SET is_demo = 0 WHERE id = 'U_DEMO'`)).not.toThrow();
    // And then it is an ordinary account again, password and all.
    expect(() => d.exec(`UPDATE users SET password_hash = 'new' WHERE id = 'U_DEMO'`)).not.toThrow();
  });

  it('cannot both lose the mark and change its password in one statement', () => {
    const d = migratedSqlite();
    seedDemo(d);
    expect(() => d.exec(
      `UPDATE users SET is_demo = 0, password_hash = 'new' WHERE id = 'U_DEMO'`))
      .toThrow(/sign-in cannot be changed/);
  });

  it('leaves every other account exactly as it was', () => {
    const d = migratedSqlite();
    seedOrdinary(d);
    for (const sql of [
      `UPDATE users SET password_hash = 'x' WHERE id = 'U_REAL'`,
      `UPDATE users SET email = 'moved@example.test' WHERE id = 'U_REAL'`,
      `UPDATE users SET totp_enabled = 1, totp_secret = 'S' WHERE id = 'U_REAL'`,
      `UPDATE users SET role = 'owner' WHERE id = 'U_REAL'`,
      `UPDATE users SET status = 'suspended' WHERE id = 'U_REAL'`,
    ]) expect(() => d.exec(sql), sql).not.toThrow();
  });

  it('is not a privileged account, and an owner cannot be made one either', () => {
    const d = migratedSqlite();
    expect(() => seedDemo(d, { role: 'owner' })).toThrow(/owner or an administrator/);
    const e = migratedSqlite();
    expect(() => seedDemo(e, { role: 'assistant' })).not.toThrow();
  });

  it('defaults to 0, so every account that already exists is unaffected', () => {
    const d = migratedSqlite();
    seedOrdinary(d);
    expect(d.prepare(`SELECT is_demo FROM users WHERE id = 'U_REAL'`).get()).toMatchObject({ is_demo: 0 });
  });
});

/**
 * Premise 3, checked rather than taken on trust: the ten-day reset does not put
 * users back, so a change to this account would be permanent, not "until
 * Thursday". That is the whole reason the guard is in the database.
 */
describe('the reset would not undo any of this', () => {
  it('users is not one of the tables the reset clears', () => {
    expect(Object.keys(TEST_TABLES)).not.toContain('users');
    expect(Object.keys(TEST_TABLES)).not.toContain('settings');
  });
});

describe('a demonstration account can never send email', () => {
  const demo = (role: 'owner' | 'admin' | 'adviser' | 'assistant' | 'readonly') =>
    ({ role, status: 'active' as const, is_demo: 1 });

  it('is refused mail:send while holding a role that normally has it', () => {
    // Not a role that happens to lack the permission: `adviser` has it, and
    // the account is refused anyway.
    expect(ROLE_PERMISSIONS.adviser).toContain('mail:send');
    expect(can({ role: 'adviser', status: 'active', is_demo: 0 }, 'mail:send')).toBe(true);
    expect(can(demo('adviser'), 'mail:send')).toBe(false);
  });

  it('is refused it in every role, including the ones it may never hold', () => {
    for (const role of ['owner', 'admin', 'adviser', 'assistant', 'readonly'] as const) {
      expect(can(demo(role), 'mail:send'), role).toBe(false);
    }
  });

  it('keeps every other permission its role carries', () => {
    for (const p of ROLE_PERMISSIONS.adviser as Permission[]) {
      if (p === 'mail:send') continue;
      expect(can(demo('adviser'), p), p).toBe(true);
    }
  });

  it('and an ordinary account is untouched', () => {
    for (const role of ['owner', 'admin', 'adviser'] as const) {
      expect(can({ role, status: 'active', is_demo: 0 }, 'mail:send'), role).toBe(true);
    }
  });
});

describe('a demonstration account is never locked out', () => {
  async function accountWith(isDemo: number): Promise<{ env: any; password: string }> {
    const db = migratedSqlite();
    const password = 'a-published-demonstration-password';
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
       VALUES ('U1','person@example.test','P',?,'adviser','active',?,?,?)`,
    ).run(await hashPassword(password), isDemo, AT, AT);
    return { env: { DB: fakeD1(db), APP_ENV: 'test' }, password };
  }

  it('survives ten wrong passwords and still signs in', async () => {
    const { env, password } = await accountWith(1);
    for (let i = 0; i < 10; i++) {
      expect(await authenticate(env, 'person@example.test', 'wrong')).toMatchObject({ ok: false, reason: 'invalid' });
    }
    expect(await authenticate(env, 'person@example.test', password)).toMatchObject({ ok: true });
  });

  it('and an ordinary account still locks after five', async () => {
    const { env, password } = await accountWith(0);
    for (let i = 0; i < 5; i++) {
      await authenticate(env, 'person@example.test', 'wrong');
    }
    expect(await authenticate(env, 'person@example.test', password)).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('does not write a lock onto the demonstration row at all', async () => {
    const { env } = await accountWith(1);
    for (let i = 0; i < 6; i++) await authenticate(env, 'person@example.test', 'wrong');
    const row = await env.DB.prepare('SELECT failed_logins, locked_until FROM users WHERE id = ?').bind('U1').first();
    expect(row).toMatchObject({ failed_logins: 0, locked_until: null });
  });

  it('still refuses the wrong password', async () => {
    const { env } = await accountWith(1);
    expect(await authenticate(env, 'person@example.test', 'wrong')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});

describe('the account page does not offer what the account cannot do', () => {
  const demoUser = fakeUser({ id: 'U_DEMO', role: 'adviser', is_demo: 1 } as any);
  const realUser = fakeUser({ id: 'U_REAL', role: 'adviser', is_demo: 0 } as any);

  it('draws neither the password form nor the two-factor form', async () => {
    const h = mountModule(authModule, { user: demoUser });
    const body = await (await h.request('/account?tab=security')).text();
    expect(body).not.toContain('action="/account/password"');
    expect(body).not.toContain('/account/2fa');
    expect(body).toContain('shared demonstration account');
  });

  it('draws both of them for anybody else', async () => {
    const h = mountModule(authModule, { user: realUser });
    const body = await (await h.request('/account?tab=security')).text();
    expect(body).toContain('action="/account/password"');
    expect(body).toContain('/account/2fa');
  });

  it('does not show one visitor the IP addresses of the others', async () => {
    const h = mountModule(authModule, { user: demoUser });
    h.db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
       VALUES ('U_DEMO','demo@example.test','D','h','adviser','active',1,?,?)`).run(AT, AT);
    h.db.prepare(
      `INSERT INTO session_records (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
       VALUES ('s_other','U_DEMO',?,?, '2099-01-01T00:00:00Z', '203.0.113.9', 'Someone else Safari')`)
      .run(AT, AT);
    const body = await (await h.request('/account?tab=sessions')).text();
    expect(body).not.toContain('203.0.113.9');
    expect(body).not.toContain('Someone else Safari');
  });

  it('refuses every route that would change the sign-in', async () => {
    const h = mountModule(authModule, { user: demoUser });
    for (const path of ['/account/password', '/account/2fa/enable', '/account/2fa/disable']) {
      const res = await h.post(path, {});
      expect(res.status, path).toBe(303);
      expect(decodeURIComponent(res.headers.get('location') ?? ''), path)
        .toMatch(/shared demonstration account/);
    }
    const res = await h.request('/account/2fa');
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/shared demonstration account/);
  });

  it('refuses to make an upload token, and refuses to sign other people out', async () => {
    const h = mountModule(authModule, { user: demoUser });
    for (const path of ['/account/upload-tokens', '/account/sessions/revoke']) {
      const res = await h.post(path, { label: 'x', sid: 'all' });
      expect(res.status, path).toBe(303);
      expect(decodeURIComponent(res.headers.get('location') ?? ''), path)
        .toMatch(/shared demonstration account/);
    }
  });

  it('still lets it choose a theme and a typeface', async () => {
    const h = mountModule(authModule, { user: demoUser });
    h.db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
       VALUES ('U_DEMO','demo@example.test','D','h','adviser','active',1,?,?)`).run(AT, AT);
    const res = await h.post('/account/appearance', { colour_mode: 'dark' });
    expect(res.status).toBe(303);
    expect(h.get<{ colour_mode: string }>(`SELECT colour_mode FROM users WHERE id = 'U_DEMO'`))
      .toMatchObject({ colour_mode: 'dark' });
  });
});

describe('an upload token held by a demonstration account stops working', () => {
  it('is refused even though the token itself is valid', async () => {
    const db = migratedSqlite();
    db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
       VALUES ('U1','p@example.test','P','h','adviser','active',0,?,?)`).run(AT, AT);
    const env = { DB: fakeD1(db) } as any;
    const made = await createUploadToken(env, { userId: 'U1', label: 'a laptop' });

    expect(await verifyUploadToken(env, made.token)).toMatchObject({ ok: true });
    db.exec(`UPDATE users SET is_demo = 1 WHERE id = 'U1'`);
    expect(await verifyUploadToken(env, made.token)).toEqual({ ok: false });
  });
});

describe('the Users page says what the account is', () => {
  function seed(h: ReturnType<typeof mountModule>): void {
    h.db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, status, is_demo, created_at, updated_at)
       VALUES ('U_DEMO','demo@example.test','Demonstration','h','adviser','active',1,?,?)`).run(AT, AT);
  }

  it('badges the row and explains why the password cannot be reset', async () => {
    const h = mountModule(adminModule, { user: fakeUser({ id: 'U_ME', role: 'owner' }) });
    seed(h);
    const body = await (await h.request('/admin/users')).text();
    expect(body).toContain('shared demonstration');
    expect(body).toMatch(/sign-in cannot/);
    expect(body).not.toContain('/admin/users/U_DEMO/reset-password');
  });

  it('refuses a password reset with a sentence rather than an error page', async () => {
    const h = mountModule(adminModule, { user: fakeUser({ id: 'U_ME', role: 'owner' }) });
    seed(h);
    const res = await h.post('/admin/users/U_DEMO/reset-password', {});
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/shared demonstration account/);
    expect(h.get(`SELECT password_hash FROM users WHERE id = 'U_DEMO'`)).toMatchObject({ password_hash: 'h' });
  });

  it('refuses a suspension, a role change and an address change, and allows a rename', async () => {
    const h = mountModule(adminModule, { user: fakeUser({ id: 'U_ME', role: 'owner' }) });
    seed(h);
    for (const form of [
      { name: 'Demonstration', email: 'demo@example.test', role: 'adviser', status: 'suspended' },
      { name: 'Demonstration', email: 'demo@example.test', role: 'owner', status: 'active' },
      { name: 'Demonstration', email: 'taken@example.test', role: 'adviser', status: 'active' },
    ]) {
      const res = await h.post('/admin/users/U_DEMO', form);
      expect(decodeURIComponent(res.headers.get('location') ?? ''), JSON.stringify(form))
        .toMatch(/shared demonstration account/);
    }
    expect(h.get(`SELECT email, role, status FROM users WHERE id = 'U_DEMO'`))
      .toMatchObject({ email: 'demo@example.test', role: 'adviser', status: 'active' });

    await h.post('/admin/users/U_DEMO', { name: 'Try the register', email: 'demo@example.test' });
    expect(h.get(`SELECT name FROM users WHERE id = 'U_DEMO'`)).toMatchObject({ name: 'Try the register' });
  });
});
