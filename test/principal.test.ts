import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * A matter has one principal applicant.
 *
 * Everything about an application is measured from that person: whose visa it
 * is, whose character and health is assessed, who the decision is about.
 * Everyone else on the file is there in relation to them. Two principals is not
 * an unusual matter — it is a data entry mistake that makes the file ambiguous
 * about the one thing it has to be certain about.
 */

const at = '2026-01-01T00:00:00Z';

function seeded() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1', 'a@b.test', 'An Adviser', 'x', 'adviser', ?, ?)`).run(at, at);
  for (const [id, ref] of [['c1', 'CL-1'], ['c2', 'CL-2']]) {
    db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
                VALUES (?, ?, 'individual', 'A PERSON', 'active', ?, ?)`).run(id, ref, at, at);
  }
  db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                 created_at, updated_at)
              VALUES ('k1', 'K-1', 'c1', 'A matter', 'wv_aewv', 'lead', 'u1', ?, ?)`).run(at, at);
  db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                 created_at, updated_at)
              VALUES ('k2', 'K-2', 'c1', 'Another', 'wv_aewv', 'lead', 'u1', ?, ?)`).run(at, at);
  return db;
}

const party = (db: ReturnType<typeof seeded>, id: string, caseId: string, clientId: string, role: string) =>
  db.prepare(`INSERT INTO case_parties (id, case_id, client_id, role, created_at)
              VALUES (?, ?, ?, ?, ?)`).run(id, caseId, clientId, role, at);

describe('the database allows only one', () => {
  it('refuses a second principal applicant on the same matter', () => {
    const db = seeded();
    party(db, 'p1', 'k1', 'c1', 'principal_applicant');
    expect(() => party(db, 'p2', 'k1', 'c2', 'principal_applicant')).toThrow(/UNIQUE/);
  });

  it('refuses one promoted into the role afterwards', () => {
    // A check only on insert is a check somebody edits their way past.
    const db = seeded();
    party(db, 'p1', 'k1', 'c1', 'principal_applicant');
    party(db, 'p2', 'k1', 'c2', 'secondary_applicant');
    expect(() => db.prepare(`UPDATE case_parties SET role = 'principal_applicant' WHERE id = 'p2'`).run())
      .toThrow(/UNIQUE/);
  });

  it('allows any number of every other role', () => {
    // Three dependent children is a family, not a mistake.
    const db = seeded();
    party(db, 'p1', 'k1', 'c1', 'dependent_child');
    expect(() => party(db, 'p2', 'k1', 'c2', 'dependent_child')).not.toThrow();
  });

  it('is per matter, not across the register', () => {
    // The same person is principal on their own matter and a supporting
    // partner on somebody else's. That is the ordinary shape of a family.
    const db = seeded();
    party(db, 'p1', 'k1', 'c1', 'principal_applicant');
    expect(() => party(db, 'p2', 'k2', 'c1', 'principal_applicant')).not.toThrow();
  });

  it('lets the role be handed over', () => {
    // The rule is one principal, not that the principal never changes.
    const db = seeded();
    party(db, 'p1', 'k1', 'c1', 'principal_applicant');
    party(db, 'p2', 'k1', 'c2', 'secondary_applicant');
    db.prepare(`UPDATE case_parties SET role = 'secondary_applicant' WHERE id = 'p1'`).run();
    expect(() => db.prepare(`UPDATE case_parties SET role = 'principal_applicant' WHERE id = 'p2'`).run())
      .not.toThrow();
  });
});

describe('what the migration did to matters that already had two', () => {
  it('demotes the later ones rather than deleting them, and says so on the record', () => {
    const migration = readFileSync('migrations/0034_one_principal_applicant.sql', 'utf8');
    expect(migration).toContain("SET role = 'secondary_applicant'");
    expect(migration).toContain('Was recorded as principal applicant');
    expect(migration).not.toMatch(/DELETE FROM case_parties/);
    // The first one keeps the role: it is the one the file was built around.
    expect(migration).toContain('SELECT MIN(id) FROM case_parties');
  });
});

describe('what the application says about it', () => {
  const parties = readFileSync('src/core/parties.ts', 'utf8');
  const cases = readFileSync('src/modules/cases/index.ts', 'utf8');

  it('names who already holds the role rather than reporting a constraint', () => {
    expect(parties).toContain('is already the principal applicant on this matter');
    expect(parties).toContain('add this person in another role, or change theirs first');
  });

  it('defaults the first party to principal, and later ones to secondary', () => {
    // A default that is wrong on the very first party is a mistake somebody
    // makes once and then has to undo.
    expect(cases).toContain("hasPrincipal ? 'secondary_applicant' : 'principal_applicant'");
    expect(cases).toContain("parties.some((p: any) => p.role === 'principal_applicant')");
  });

  it('applies the same default to both ways of adding one', () => {
    expect(cases.match(/hasPrincipal \? 'secondary_applicant' : 'principal_applicant'/g) ?? [])
      .toHaveLength(2);
  });
});
