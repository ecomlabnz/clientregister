import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
// Reached through the runtime rather than imported: the bundler this suite
// runs under does not resolve `node:sqlite` as a builtin.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * A matter always belongs to somebody.
 *
 * The rule tasks have had since they were built, now applied to matters for the
 * same reason: one nobody owns is one nobody is doing. "Unassigned" is not a
 * state a practice can be in — it is a gap that looks like a state.
 *
 * Enforced in the database, and tested by attacking the database. A guarantee
 * in the route that happens to write the row lasts until somebody adds a second
 * route, and this application already has three places that write a case.
 */

const cases = readFileSync('src/modules/cases/index.ts', 'utf8');

function seeded() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  const at = '2026-01-01T00:00:00Z';
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1', 'a@b.test', 'An Adviser', 'x', 'adviser', ?, ?)`).run(at, at);
  db.prepare(`INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
              VALUES ('c1', 'CL-1', 'individual', 'A PERSON', 'active', ?, ?)`).run(at, at);
  return db;
}

const insert = (db: ReturnType<typeof seeded>, ref: string, owner: string | null) =>
  db.prepare(`INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to,
                                 created_at, updated_at)
              VALUES (?, ?, 'c1', 'A matter', 'wv_aewv', 'lead', ?, 'x', 'x')`)
    .run(`k_${ref}`, ref, owner);

describe('the database refuses a matter with no owner', () => {
  it('on insert', () => {
    const db = seeded();
    expect(() => insert(db, 'K-1', null)).toThrow(/assigned to somebody/);
    expect(() => insert(db, 'K-2', 'u1')).not.toThrow();
  });

  it('on update, so it cannot be cleared afterwards', () => {
    const db = seeded();
    insert(db, 'K-1', 'u1');
    expect(() => db.prepare(`UPDATE cases SET assigned_to = NULL WHERE ref = 'K-1'`).run())
      .toThrow(/assigned to somebody/);
    const after = db.prepare(`SELECT assigned_to FROM cases WHERE ref = 'K-1'`)
      .all() as Array<{ assigned_to: string }>;
    expect(after[0]!.assigned_to).toBe('u1');
  });

  it('still allows handing one over', () => {
    // The rule is that it has an owner, not that the owner never changes.
    const db = seeded();
    const at = '2026-01-01T00:00:00Z';
    db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
                VALUES ('u2', 'c@d.test', 'Another', 'x', 'adviser', ?, ?)`).run(at, at);
    insert(db, 'K-1', 'u1');
    expect(() => db.prepare(`UPDATE cases SET assigned_to = 'u2' WHERE ref = 'K-1'`).run())
      .not.toThrow();
  });
});

describe('what the migration did to matters already adrift', () => {
  it('gives them an owner rather than deleting or leaving them', () => {
    // Nothing is lost to tidiness. Whoever created it, and failing that the
    // practice's first owner or administrator.
    const migration = readFileSync('migrations/0033_cases_have_an_owner.sql', 'utf8');
    expect(migration).toContain('COALESCE(');
    expect(migration).toContain('created_by');
    expect(migration).toMatch(/WHEN 'owner' THEN 0 WHEN 'admin' THEN 1/);
    expect(migration).not.toMatch(/DELETE FROM cases/);
  });
});

describe('the form agrees with the database', () => {
  it('offers no blank option', () => {
    expect(cases).not.toContain("includeBlank: 'Unassigned'");
    expect(cases).toMatch(/name: 'assigned_to', required: true, includeBlank: false/);
  });

  it('requires it when reading the form, so a blank is a form error', () => {
    // Otherwise a blank reaches the trigger and the person is shown a database
    // message about matters instead of a field marked red.
    expect(cases).toContain("assigned_to: f.text('assigned_to', { required: true");
  });

  it('does not write null where the column cannot hold one', () => {
    expect(cases).not.toContain('v.assigned_to || null');
  });

  it('defaults to whoever is opening it', () => {
    // Right far more often than not, and one fewer decision on a long form.
    expect(cases).toContain("value: values.assigned_to ?? c.get('user')?.id ?? ''");
  });
});

describe('the owner has to be somebody who can do the work', () => {
  it('is checked on both routes that write a matter', () => {
    // A suspended account cannot sign in, so a matter assigned to one is a
    // matter nobody is doing — the failure the rule exists to prevent, one
    // level up where a person can be told about it.
    expect(cases.match(/isAssignable\(c\.env, v\.assigned_to\)/g) ?? []).toHaveLength(2);
    expect(cases).toContain("Choose an active user.");
  });

  it('shares the check with tasks rather than keeping a second copy', () => {
    const tasks = readFileSync('src/modules/tasks/index.ts', 'utf8');
    const lookups = readFileSync('src/core/lookups.ts', 'utf8');
    expect(lookups).toContain('export async function isAssignable');
    expect(tasks).not.toContain('async function isAssignable');
    expect(tasks).toContain("import { isAssignable, userOptions } from '../../core/lookups'");
  });
});
