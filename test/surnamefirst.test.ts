/**
 * A matter, a quotation and a picker all carry the surname first.
 *
 * **Asked for on 12 September 2026**, of the matter dropdown on a new
 * quotation: *"it is just impossible to search through this! we need a better
 * system, also - can we make sure that this such places the surnames are
 * before the names?"*
 *
 * Two rules are pinned here.
 *
 *  * **A name in a label reads "FAMILY, Given".** The display name —
 *    "Given FAMILY", natural order — is untouched and is still what
 *    correspondence uses. A label is a different job.
 *  * **The type still comes first.** That half is the practice's own decision
 *    and turning the name around must not disturb it.
 *
 * The second half of this file is the rehearsal of migration 0092 against the
 * shapes the live register actually holds — a person with both names, a person
 * with only a surname, a person with no surname at all, a company, and a
 * quotation the client has already accepted. Invented names throughout: no
 * client of the practice appears in this repository.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { caseName, clientFileName } from '../src/core/casename';
import { clientOptions } from '../src/core/lookups';
import { findBox } from '../src/ui/components';
import { fakeD1, migratedSqlite } from './support/d1';
import type { Env } from '../src/types';

const AT = '2026-09-12T09:00:00Z';
const RENAME = '0092_a_matter_carries_the_surname_first.sql';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/** A migrated database, and the env a core function reads it through. */
function fresh() {
  const db = migratedSqlite();
  seedUser(db);
  return { db, env: { DB: fakeD1(db) } as unknown as Env };
}

function seedUser(db: any) {
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,status,created_at,updated_at)
              VALUES ('u1','a@example.test','A User','x','admin','active',?,?)`).run(AT, AT);
}

/** The schema as it stood the moment before the rename migration ran. */
function schemaBefore() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    if (file === RENAME) break;
    db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  seedUser(db);
  return db;
}

function person(db: any, id: string, ref: string, given: string | null, family: string | null) {
  const full = [given, family].filter(Boolean).join(' ');
  db.prepare(`INSERT INTO clients (id,ref,kind,full_name,given_names,family_name,status,created_at,updated_at)
              VALUES (?,?,'individual',?,?,?,'active',?,?)`).run(id, ref, full, given, family, AT, AT);
}

function matter(db: any, id: string, ref: string, clientId: string, title: string) {
  db.prepare(`INSERT INTO cases (id,ref,client_id,title,case_type,status,assigned_to,created_at,updated_at)
              VALUES (?,?,?,?,'partner','open','u1',?,?)`).run(id, ref, clientId, title, AT, AT);
}

describe('the name a label carries', () => {
  it('puts the surname first, and keeps the type in front of it', () => {
    expect(caseName('RV. Partner', 'VUONG, Bao Long')).toBe('RV. Partner — VUONG, Bao Long');
  });

  it('reads a person out of the register as "FAMILY, Given"', async () => {
    const h = fresh();
    person(h.db, 'cl1', 'CL-0901', 'Bao Long', 'VUONG');
    expect(await clientFileName(h.env, 'cl1')).toBe('VUONG, Bao Long');
  });

  it('leaves a company exactly as its own register writes it', async () => {
    const h = fresh();
    h.db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                  VALUES ('or1','CL-0902','organisation','ACME PACKING LIMITED','active',?,?)`).run(AT, AT);
    expect(await clientFileName(h.env, 'or1')).toBe('ACME PACKING LIMITED');
  });

  it('falls back to the whole name when no surname is recorded', async () => {
    const h = fresh();
    person(h.db, 'cl2', 'CL-0903', 'Sione', null);
    expect(await clientFileName(h.env, 'cl2')).toBe('Sione');
  });

  it('is null for no client, which the composer already handles', async () => {
    const h = fresh();
    expect(await clientFileName(h.env, null)).toBe(null);
    expect(await clientFileName(h.env, 'nobody')).toBe(null);
  });
});

describe('the client picker', () => {
  it('labels and orders by surname, not by given name', async () => {
    const h = fresh();
    // Given-name order would put Ana first and Bao last. Surname order is the
    // reverse, which is the whole point of the change.
    person(h.db, 'c1', 'CL-0911', 'Ana', 'ZHANG');
    person(h.db, 'c2', 'CL-0912', 'Bao Long', 'ABAD');
    const opts = await clientOptions(h.env);
    expect(opts.map((o) => o.label)).toEqual([
      'ABAD, Bao Long (CL-0912)',
      'ZHANG, Ana (CL-0911)',
    ]);
  });

  it('sorts a company in among the people rather than ahead of them all', async () => {
    // The reason `COLLATE NOCASE` is there: a surname is stored in capitals and
    // a registered name is not, and SQLite compares text by byte.
    const h = fresh();
    person(h.db, 'c1', 'CL-0921', 'Ana', 'ZHANG');
    h.db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                  VALUES ('c2','CL-0922','organisation','Meridian Produce','active',?,?)`).run(AT, AT);
    person(h.db, 'c3', 'CL-0923', 'Bao Long', 'ABAD');
    const opts = await clientOptions(h.env);
    expect(opts.map((o) => o.label)).toEqual([
      'ABAD, Bao Long (CL-0923)',
      'Meridian Produce (CL-0922)',
      'ZHANG, Ana (CL-0921)',
    ]);
  });

  it('leaves an archived client out', async () => {
    const h = fresh();
    person(h.db, 'c1', 'CL-0931', 'Ana', 'ZHANG');
    h.db.prepare(`UPDATE clients SET status='archived' WHERE id='c1'`).run();
    expect(await clientOptions(h.env)).toEqual([]);
  });
});

describe('migration 0092, rehearsed', () => {
  function rehearse() {
    const db = schemaBefore();
    person(db, 'p1', 'CL-0941', 'Bao Long', 'VUONG');
    person(db, 'p2', 'CL-0942', null, 'TAMANG');
    person(db, 'p3', 'CL-0943', 'Sione', null);
    db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                VALUES ('o1','CL-0944','organisation','ACME PACKING LIMITED','active',?,?)`).run(AT, AT);

    matter(db, 'm1', 'CASE-26-001', 'p1', 'RV. Partner — Bao Long VUONG');
    matter(db, 'm2', 'CASE-26-002', 'p2', 'VV. General — TAMANG');
    matter(db, 'm3', 'CASE-26-003', 'p3', 'OT. Advice Only — Sione');
    matter(db, 'm4', 'CASE-26-004', 'o1', 'EMP. Employer Accreditation — ACME PACKING LIMITED');
    // A matter named before the convention existed, with no em dash in it.
    matter(db, 'm5', 'CASE-26-005', 'p1', 'Something somebody typed in full');

    const quote = (id: string, ref: string, clientId: string, desc: string, accepted: boolean) => {
      db.prepare(`INSERT INTO quotes (id,ref,client_id,description,amount_cents,status,
                                      created_at,updated_at,accepted_at,accepted_name,accepted_from)
                  VALUES (?,?,?,?,100000,?,?,?,?,?,?)`).run(
        id, ref, clientId, desc, accepted ? 'accepted' : 'draft', AT, AT,
        accepted ? AT : null, accepted ? 'Bao Long VUONG' : null, accepted ? '203.0.113.4' : null);
    };
    quote('q1', 'Q-26-001', 'p1', 'RV. Partner — Bao Long VUONG', false);
    quote('q2', 'Q-26-002', 'p1', 'RV. Partner — Bao Long VUONG', true);
    quote('q3', 'Q-26-003', 'p1', 'An older free-text description', false);

    db.exec(readFileSync(`migrations/${RENAME}`, 'utf8'));
    return db;
  }

  const title = (db: any, id: string) =>
    (db.prepare('SELECT title FROM cases WHERE id = ?').get(id) as { title: string }).title;
  const desc = (db: any, id: string) =>
    (db.prepare('SELECT description FROM quotes WHERE id = ?').get(id) as { description: string }).description;

  it('turns the name around and leaves the type alone', () => {
    expect(title(rehearse(), 'm1')).toBe('RV. Partner — VUONG, Bao Long');
  });

  it('writes no stray comma for somebody with only a surname', () => {
    expect(title(rehearse(), 'm2')).toBe('VV. General — TAMANG');
  });

  it('leaves a person with no surname recorded exactly as they were', () => {
    expect(title(rehearse(), 'm3')).toBe('OT. Advice Only — Sione');
  });

  it('leaves a company alone', () => {
    expect(title(rehearse(), 'm4')).toBe('EMP. Employer Accreditation — ACME PACKING LIMITED');
  });

  it('does not touch a name it cannot find the seam in', () => {
    expect(title(rehearse(), 'm5')).toBe('Something somebody typed in full');
  });

  it('renames a quotation the same way', () => {
    expect(desc(rehearse(), 'q1')).toBe('RV. Partner — VUONG, Bao Long');
  });

  it('leaves an accepted quotation exactly as it was accepted', () => {
    // Migration 0079 froze it, and would have refused the whole migration.
    // That refusal is the reason the guard is there; this is the proof it is.
    expect(desc(rehearse(), 'q2')).toBe('RV. Partner — Bao Long VUONG');
  });

  it('leaves a free-text description alone', () => {
    expect(desc(rehearse(), 'q3')).toBe('An older free-text description');
  });

  it('changes nothing a second time it is run', () => {
    const db = rehearse();
    db.exec(readFileSync(`migrations/${RENAME}`, 'utf8'));
    expect(title(db, 'm1')).toBe('RV. Partner — VUONG, Bao Long');
  });
});

describe('the box on the page', () => {
  // What Chromium confirmed on 12 September 2026 — that the input and the list
  // are wired together, that the lines are surname-ordered, and that typing a
  // fragment posts the fragment — pinned here so it cannot quietly come apart.
  // The suggestion popup itself is the browser's own furniture and is not in
  // the page, so it is not assertable; what is assertable is that every line is
  // in the value, which is why every browser can filter on it.
  it('is an input tied to a list of every choice', async () => {
    const h = fresh();
    person(h.db, 'c1', 'CL-0951', 'Bao Long', 'VUONG');
    person(h.db, 'c2', 'CL-0952', 'Thi Kim Oanh', 'DOAN');
    const opts = await clientOptions(h.env);
    const drawn = findBox({ label: 'Client', name: 'client_id', value: '', options: opts }).toString();
    expect(drawn).toContain('<input id="f_client_id" name="client_id" type="text" list="client_id-choices"');
    expect(drawn).toContain('<datalist id="client_id-choices">');
    expect(drawn).toContain('<option value="DOAN, Thi Kim Oanh (CL-0952)"></option>');
    expect(drawn).toContain('<option value="VUONG, Bao Long (CL-0951)"></option>');
  });

  it('carries no label attribute, because browsers disagree about matching it', () => {
    const drawn = findBox({ label: 'Client', name: 'client_id', value: '',
                            options: [{ value: 'c1', label: 'VUONG, Bao Long (CL-0951)' }] }).toString();
    expect(drawn).not.toContain('label="');
  });

  it('shows the line for a value it was given, not the id', () => {
    const drawn = findBox({ label: 'Matter', name: 'case_id', value: 'k1',
                            options: [{ value: 'k1', label: 'RV. Partner — VUONG, Bao Long (CASE-26-014)' }] }).toString();
    expect(drawn).toContain('value="RV. Partner — VUONG, Bao Long (CASE-26-014)"');
    expect(drawn).not.toContain('value="k1"');
  });
});
