/**
 * The demonstration seed still runs.
 *
 * It had rotted in four separate ways, none of which anything noticed, because
 * nothing ever ran it against the schema it writes into:
 *
 *   1. `clients.nationality`, a column dropped in favour of
 *      `client_nationalities`.
 *   2. Country names where migration 0055 requires ISO alpha-2 codes.
 *   3. No `assigned_to` on a matter, which a trigger has long refused.
 *   4. `fee_items` and `fee_shares`, dropped when money moved into quotes and
 *      invoices.
 *
 * Each one would have shown up the first time somebody seeded a fresh copy —
 * which is exactly the moment a demonstration is being set up for somebody.
 *
 * So the seed is run here, against every migration, with foreign keys and
 * triggers on. It is the same method the register uses for its own guarantees:
 * execute it, do not assume it.
 */

import { describe, expect, it } from 'vitest';
// Reached through the runtime: this suite's types are the Workers ones, which
// do not declare node:child_process — the same reason node:sqlite is reached
// the way it is below.
const { execFileSync } = (process as any).getBuiltinModule('node:child_process') as {
  execFileSync: (cmd: string, args: string[], opts: Record<string, unknown>) => string;
};
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-01-01T00:00:00Z';

function seeded() {
  const sql = execFileSync('node', ['scripts/seed-demo.mjs'], { encoding: 'utf8', maxBuffer: 32e6 });
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  // The seed assigns work to whoever is signed in, so somebody has to be.
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
              VALUES ('u1','a@b.test','A Lawyer','x','owner','active',?,?)`).run(AT, AT);
  db.exec(sql);
  const count = (t: string) => ((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`) as any).get() as any).n as number;
  return { db, count };
}

describe('seeding a fresh register', () => {
  it('applies against the real schema, triggers and all', () => {
    // The whole test. If the seed writes to a column that no longer exists, or
    // breaks an invariant, this throws with the reason.
    expect(() => seeded()).not.toThrow();
  });

  it('produces something worth demonstrating', () => {
    const { count } = seeded();
    expect(count('clients')).toBeGreaterThan(10);
    expect(count('cases')).toBeGreaterThan(10);
    expect(count('case_parties')).toBeGreaterThan(10);
    expect(count('tasks')).toBeGreaterThan(0);
    expect(count('quotes')).toBeGreaterThan(0);
    // Money, which now means invoices.
    expect(count('invoices')).toBeGreaterThan(0);
    expect(count('invoice_items')).toBeGreaterThan(0);
  });

  it('marks every row it writes, so it can be taken out again', () => {
    // The register holds real client files. Demonstration data that cannot be
    // told apart from a real record is worse than none.
    const { db } = seeded();
    for (const t of ['clients', 'cases', 'invoices', 'quotes', 'tasks']) {
      const rows = db.prepare(`SELECT id FROM ${t}`).all() as any[];
      expect(rows.length, t).toBeGreaterThan(0);
      expect(rows.every((r) => String(r.id).startsWith('demo_')), t).toBe(true);
    }
  });

  it('gives every matter an owner, which the database insists on', () => {
    const { db } = seeded();
    const orphans = ((db.prepare(
      'SELECT COUNT(*) AS n FROM cases WHERE assigned_to IS NULL') as any).get() as any).n;
    expect(orphans).toBe(0);
  });

  it('writes country codes, not country names', () => {
    const { db } = seeded();
    const bad = db.prepare(
      `SELECT passport_country FROM clients
        WHERE passport_country IS NOT NULL AND LENGTH(passport_country) <> 2`).all() as any[];
    expect(bad).toEqual([]);
  });

  it('can be taken out again completely', () => {
    // The removal script is the other half of the promise, and it named two
    // tables that no longer exist. A removal that throws leaves demonstration
    // data in a register that holds real client files.
    const { db, count } = seeded();
    expect(count('clients')).toBeGreaterThan(0);
    expect(() => db.exec(readFileSync('scripts/seed-demo-remove.sql', 'utf8'))).not.toThrow();
    for (const t of ['clients', 'cases', 'invoices', 'invoice_items', 'quotes', 'tasks']) {
      expect(count(t), t).toBe(0);
    }
  });

  it('issues an invoice only after its lines are on it', () => {
    // An issued invoice cannot gain a line, so the order is not a style choice.
    // Every issued invoice here has at least one.
    const { db } = seeded();
    const empty = db.prepare(
      `SELECT i.ref FROM invoices i
        WHERE i.status <> 'draft'
          AND NOT EXISTS (SELECT 1 FROM invoice_items li WHERE li.invoice_id = i.id)`).all() as any[];
    expect(empty).toEqual([]);
  });
});
