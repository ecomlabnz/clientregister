/**
 * A D1 stand-in backed by `node:sqlite`, so a route can be exercised in a test
 * the way a request exercises it in production — through the real handler, the
 * real middleware and the real triggers — rather than by reaching past them.
 *
 * The application only ever touches D1 through the thin surface in
 * `src/core/db.ts`: `prepare(sql).bind(...params).first()/.all()/.run()`. This
 * mirrors exactly that surface over an in-memory SQLite database built from the
 * migrations, and nothing more. It is a test double, not a second D1: if a new
 * query uses a shape of the D1 API this does not cover, add it here rather than
 * working around it in the test.
 *
 * Foreign keys are on, because the guarantees this exists to test are written
 * as foreign keys and triggers and are silent without them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { AppContext, SessionData, User } from '../../src/types';
import type { AppModule } from '../../src/core/module';

// Reached through the runtime rather than imported: the bundler this suite runs
// under does not resolve `node:sqlite` as a builtin and tries to load a package
// called "sqlite" instead. (Same reason as test/schema.test.ts.)
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

type SqliteDb = InstanceType<typeof DatabaseSync>;

class FakeBoundStatement {
  constructor(private db: SqliteDb, private sql: string, private params: unknown[]) {}

  private stmt(): any {
    return this.db.prepare(this.sql);
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...(this.params as any[])) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    if (column !== undefined) return (row[column] ?? null) as T;
    return row as T;
  }

  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const rows = this.stmt().all(...(this.params as any[])) as T[];
    return { results: rows, success: true, meta: {} };
  }

  async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
    const info = this.stmt().run(...(this.params as any[])) as { changes: number; lastInsertRowid: number };
    return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
  }
}

class FakeStatement {
  constructor(private db: SqliteDb, private sql: string) {}
  bind(...params: unknown[]): FakeBoundStatement {
    return new FakeBoundStatement(this.db, this.sql, params);
  }
}

/** A D1Database-shaped object over an in-memory SQLite database. */
export function fakeD1(db: SqliteDb): D1Database {
  return {
    prepare: (sql: string) => new FakeStatement(db, sql) as unknown as D1PreparedStatement,
  } as unknown as D1Database;
}

/** An in-memory database with every migration applied, foreign keys enforced. */
export function migratedSqlite(): SqliteDb {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  return db;
}

/** A signed-in user with a role, everything else filled with harmless defaults. */
export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u_test', email: 'tester@example.test', name: 'A Tester',
    role: 'admin', status: 'active', totp_enabled: 0,
    theme: 'light', colour_mode: 'light',
    ...overrides,
  } as User;
}

function fakeSession(user: User): SessionData {
  return {
    sid: 's_test', userId: user.id, csrf: 'test-csrf-token',
    createdAt: Date.now(), expiresAt: Date.now() + 3_600_000, verified: true,
  };
}

export interface Harness {
  db: SqliteDb;
  env: { DB: D1Database } & Record<string, unknown>;
  /** Issue a request as the mounted user. CSRF and origin are satisfied. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** Convenience: a same-origin POST carrying the session CSRF token. */
  post(path: string, form?: Record<string, string>): Promise<Response>;
  /** Read one row straight from the database, to check what a handler did. */
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null;
  /** Count rows matching a query — a `SELECT COUNT(*) AS n` is run for you. */
  count(sql: string, ...params: unknown[]): number;
}

/**
 * Mount one module on a bare app with a signed-in user injected, and no auth or
 * CSRF middleware in front — those are tested on their own. This is for testing
 * what a handler does *once a permitted user reaches it*: the invariants it
 * keeps, the records it writes, the ones it refuses.
 */
export function mountModule(module: AppModule, opts: { user?: User; env?: Record<string, unknown> } = {}): Harness {
  const db = migratedSqlite();
  const user = opts.user ?? fakeUser();
  const session = fakeSession(user);
  const env = { DB: fakeD1(db), APP_ENV: 'test', ...opts.env } as Harness['env'];

  const app = new Hono<AppContext>();
  app.use('*', async (c, next) => {
    c.set('user', user.status === 'active' ? user : (user as User));
    c.set('session', session);
    c.set('requestId', 'req_test');
    c.set('nonce', 'nonce_test');
    await next();
  });
  module.register(app);

  const origin = 'http://localhost';
  const request = async (path: string, init: RequestInit = {}): Promise<Response> =>
    app.request(`${origin}${path}`, init, env as any);

  const post = async (path: string, form: Record<string, string> = {}): Promise<Response> => {
    const body = new URLSearchParams({ _csrf: session.csrf, ...form });
    return request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body,
    });
  };

  const get = <T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | null =>
    ((db.prepare(sql) as any).get(...(params as any[])) as T | undefined) ?? null;
  const count = (sql: string, ...params: unknown[]): number =>
    (get<{ n: number }>(sql, ...params)?.n) ?? 0;

  return { db, env, request, post, get, count };
}
