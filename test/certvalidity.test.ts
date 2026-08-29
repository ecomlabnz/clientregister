import { beforeEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { CERTIFICATE_VALIDITY, expiryIsDerived, validityRule } from '../src/core/certificates';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * How long a certificate lasts, proved by asking the database.
 *
 * INZ does not read the expiry printed on a police certificate; it applies its
 * own arithmetic, and the arithmetic has a branch — six months from issue, or
 * twenty-four once the certificate has gone in with an application. Medicals
 * are three and thirty-six. Typed by hand that goes wrong quietly, so the
 * database works it out, and this runs the real triggers rather than reading
 * them.
 *
 * Every date here is invented.
 */

let db: InstanceType<typeof DatabaseSync>;

function expiry(id: string): string | null {
  const row = db.prepare('SELECT expires_on FROM client_certificates WHERE id = ?').all(id) as
    Array<{ expires_on: string | null }>;
  return row[0]?.expires_on ?? null;
}

function add(id: string, kind: string, issued: string | null,
             opts: { submitted?: string | null; expires?: string | null } = {}) {
  db.prepare(`INSERT INTO client_certificates
                (id, client_id, kind, issued_on, submitted_on, expires_on, created_at)
              VALUES (?, 'c1', ?, ?, ?, ?, '2026-01-01T00:00:00Z')`)
    .run(id, kind, issued, opts.submitted ?? null, opts.expires ?? null);
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1', 'CL-1', 'individual', 'A PERSON', 'active', ?, ?)`)
    .run('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
});

describe('a certificate held but not submitted', () => {
  it('gives a police certificate six months', () => {
    add('p', 'police', '2026-01-15');
    expect(expiry('p')).toBe('2026-07-15');
  });

  it('gives a medical three months', () => {
    add('m', 'medical', '2026-01-15');
    expect(expiry('m')).toBe('2026-04-15');
  });
});

describe('a certificate submitted with an application', () => {
  it('gives a police certificate twenty-four months from issue, not from lodgement', () => {
    // From issue. Lodging it later does not buy more time; it converts the
    // clock that has already been running.
    add('p', 'police', '2026-01-15', { submitted: '2026-05-01' });
    expect(expiry('p')).toBe('2028-01-15');
  });

  it('gives a medical thirty-six months from issue', () => {
    add('m', 'medical', '2026-01-15', { submitted: '2026-05-01' });
    expect(expiry('m')).toBe('2029-01-15');
  });

  it('moves the expiry the moment the submission is recorded', () => {
    // The point of the whole change: you record the fact, and the date follows.
    add('p', 'police', '2026-01-15');
    expect(expiry('p')).toBe('2026-07-15');
    db.prepare(`UPDATE client_certificates SET submitted_on = '2026-05-01' WHERE id = 'p'`).run();
    expect(expiry('p')).toBe('2028-01-15');
  });

  it('moves it back if the submission is cleared', () => {
    add('m', 'medical', '2026-01-15', { submitted: '2026-02-01' });
    expect(expiry('m')).toBe('2029-01-15');
    db.prepare(`UPDATE client_certificates SET submitted_on = NULL WHERE id = 'm'`).run();
    expect(expiry('m')).toBe('2026-04-15');
  });
});

describe('the end of a month', () => {
  it('stops at the last day rather than rolling into the next month', () => {
    // SQLite's date(d, '+6 months') turns 31 March into 1 October. Rolling
    // forward is the dangerous direction: it would have the register call a
    // certificate live on a day it is not.
    add('p', 'police', '2026-03-31');
    expect(expiry('p')).toBe('2026-09-30');
    add('m', 'medical', '2026-05-31');
    expect(expiry('m')).toBe('2026-08-31');
    // A February landing, for the same reason.
    add('m2', 'medical', '2026-11-30');
    expect(expiry('m2')).toBe('2027-02-28');
  });

  it('leaves an ordinary date alone', () => {
    add('p', 'police', '2026-03-15');
    expect(expiry('p')).toBe('2026-09-15');
  });
});

describe('what the rule does not touch', () => {
  it('leaves the expiry on a chest x-ray as it was entered', () => {
    // No rule has been stated for an x-ray, and inventing one would be worse
    // than leaving it alone.
    add('x', 'chest_xray', '2026-01-15', { expires: '2026-11-01' });
    expect(expiry('x')).toBe('2026-11-01');
    expect(expiryIsDerived('chest_xray')).toBe(false);
  });

  it('leaves a certificate with no issue date alone', () => {
    // Nothing to compute from. The expiry somebody typed is all there is.
    add('p', 'police', null, { expires: '2026-12-01' });
    expect(expiry('p')).toBe('2026-12-01');
  });
});

describe('the database owns the date', () => {
  it('overwrites an expiry written straight into the column', () => {
    // A guarantee in the route that writes the row lasts until somebody adds a
    // second route. This one is attacked directly, which is the only way to
    // know it holds.
    add('p', 'police', '2026-01-15');
    db.prepare(`UPDATE client_certificates SET expires_on = '2099-01-01' WHERE id = 'p'`).run();
    expect(expiry('p')).toBe('2026-07-15');
  });

  it('holds even with recursive triggers switched on', () => {
    // The trigger updates the table it fires on. The termination guard is the
    // WHERE clause: once the stored value agrees with the rule the update
    // changes no rows, so nothing fires again.
    db.exec('PRAGMA recursive_triggers=ON');
    add('p', 'police', '2026-01-15');
    expect(expiry('p')).toBe('2026-07-15');
    db.prepare(`UPDATE client_certificates SET submitted_on = '2026-02-01' WHERE id = 'p'`).run();
    expect(expiry('p')).toBe('2028-01-15');
  });

  it('reports the same answer through the view the triggers use', () => {
    add('p', 'police', '2026-03-31', { submitted: '2026-04-02' });
    const row = db.prepare(`SELECT expires_on, expires_computed FROM certificate_validity WHERE id = 'p'`)
      .all() as Array<{ expires_on: string; expires_computed: string }>;
    expect(row[0]!.expires_on).toBe(row[0]!.expires_computed);
    expect(row[0]!.expires_on).toBe('2028-03-31');
  });
});

describe('what the page says about it', () => {
  it('describes the rule without applying it', () => {
    // Two copies of the arithmetic would be the original problem one level up.
    expect(validityRule('police')).toBe(
      '6 months from issue — 24 months once it has gone in with an application.');
    expect(validityRule('medical')).toBe(
      '3 months from issue — 36 months once it has gone in with an application.');
    expect(validityRule('chest_xray')).toBeNull();
  });

  it('agrees with the numbers the database uses', () => {
    // If the migration and the wording ever disagree, the page is lying about
    // a date somebody is relying on.
    for (const [kind, months] of Object.entries(CERTIFICATE_VALIDITY)) {
      if (!months) continue;
      add(kind, kind, '2026-01-15');
      const held = expiry(kind)!;
      db.prepare('UPDATE client_certificates SET submitted_on = ? WHERE id = ?')
        .run('2026-02-01', kind);
      const submitted = expiry(kind)!;
      expect(monthsBetween('2026-01-15', held)).toBe(months.held);
      expect(monthsBetween('2026-01-15', submitted)).toBe(months.submitted);
    }
  });
});

/** Whole months between two ISO dates that share a day of the month. */
function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number, number];
  return (ty - fy) * 12 + (tm - fm);
}
