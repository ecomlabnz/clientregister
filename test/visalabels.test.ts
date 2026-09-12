/**
 * Thirty-five records that held a description where the register holds a code.
 *
 * **Found on 12 September 2026**, sweeping every coded column in the practice's
 * register after they spotted two raw codes on the Cases list. Two columns
 * nobody had ever checked held the *label* instead of the key —
 * `Work Visa - Accredited Employer Work Visa` where every other row holds
 * `wv_aewv`. All of them arrived in a bulk load on 1 September.
 *
 * **Why nobody saw it, and why it mattered anyway.** An unrecognised value is
 * displayed as it was stored, so the client page read "Work Visa - Accredited
 * Employer Work Visa" and looked right. But the dropdown offers only the keys,
 * so the field rendered **blank** — and opening one of those clients and
 * pressing Save erased their visa type. Thirty-five records, one press each.
 *
 * The migration is rehearsed here against the shapes the live register actually
 * holds: the five visa descriptions and the five English-test spellings in the
 * counts they were found in, rows that are already correct, and one string
 * deliberately *similar* to a bad one, which must survive untouched.
 *
 * Every name here is invented. No client of the practice appears in this
 * repository.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const FIX = '0097_the_seasonal_visas_and_thirty_five_labels.sql';

/** The practice's stored list: the default text, with the CRLF a textarea saves. */
function storedVisaList(): string {
  const src = readFileSync('src/core/vocabulary.ts', 'utf8');
  const block = src.match(/VISA_TYPE_VOCAB[\s\S]*?defaults: `([\s\S]*?)`,/)?.[1];
  expect(block, 'the visa vocabulary could not be read').toBeTruthy();
  return block!
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim()
    .replace(/\n/g, '\r\n');
}

/** Every migration up to but not including the correction. */
function before(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    if (file === FIX) break;
    db.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  return db;
}

const VISA_ROWS: Array<[string, number, string]> = [
  ['Work Visa - Accredited Employer Work Visa', 10, 'wv_aewv'],
  ['Work Visa - Partnership', 2, 'wv_partner'],
  ['Work Visa - Peak Seasonal Visa', 1, 'wv_aewv_psv'],
  ['Visitor Visa - General', 1, 'vv_visitor'],
  ['Interim Visa', 1, 'other_interim'],
];

const ENGLISH_ROWS: Array<[string, number, string]> = [
  ['PTE Academic', 15, 'pte'],
  ['PTE', 2, 'pte'],
  ['IELTS', 1, 'ielts'],
  ['IELTS General', 1, 'ielts'],
  ['IELTS General Training', 1, 'ielts'],
];

/** A register shaped like the practice's on the morning this was found. */
function seeded(over: { list?: string } = {}) {
  const db = before();
  db.prepare("INSERT INTO settings (key,value,updated_at) VALUES ('vocab.visa_types',?,'2026-09-01')")
    .run(over.list ?? storedVisaList());
  let n = 0;
  const add = (visa: string | null, eng: string | null) => {
    n++;
    db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,current_visa_type,english_test_type,created_at,updated_at)
                VALUES (?,?,'individual','A PERSON','active',?,?,'2026-09-01','2026-09-01')`)
      .run('c' + n, 'CL-' + String(n).padStart(4, '0'), visa, eng);
  };
  for (const [label, count] of VISA_ROWS) for (let i = 0; i < count; i++) add(label, null);
  for (const [label, count] of ENGLISH_ROWS) for (let i = 0; i < count; i++) add(null, label);
  for (let i = 0; i < 88; i++) add('wv_aewv', 'pte');            // already correct
  add('Work Visa - Accredited Employer Work Visa (old)', null);  // must survive
  return db;
}

const run = (db: any) => db.exec(readFileSync(`migrations/${FIX}`, 'utf8'));
const count = (db: any, sql: string, ...p: unknown[]): number =>
  (db.prepare(sql).get(...p) as { n: number }).n;

describe('the thirty-five labels become keys', () => {
  it('loses no client', () => {
    const db = seeded();
    const was = count(db, 'SELECT COUNT(*) AS n FROM clients');
    run(db);
    expect(count(db, 'SELECT COUNT(*) AS n FROM clients')).toBe(was);
  });

  it('maps every visa description to the key it describes', () => {
    const db = seeded();
    run(db);
    for (const [label, howMany, key] of VISA_ROWS) {
      expect(count(db, 'SELECT COUNT(*) AS n FROM clients WHERE current_visa_type = ?', label), label)
        .toBe(0);
      // `wv_aewv` also has 88 rows that were right all along.
      const extra = key === 'wv_aewv' ? 88 : 0;
      expect(count(db, 'SELECT COUNT(*) AS n FROM clients WHERE current_visa_type = ?', key), key)
        .toBe(howMany + extra);
    }
  });

  it('maps every spelling of a test to one key', () => {
    const db = seeded();
    run(db);
    expect(count(db, `SELECT COUNT(*) AS n FROM clients WHERE english_test_type = 'pte'`))
      .toBe(15 + 2 + 88);
    expect(count(db, `SELECT COUNT(*) AS n FROM clients WHERE english_test_type = 'ielts'`))
      .toBe(3);
  });

  it('leaves a string that merely looks similar exactly as it was', () => {
    // The statements match in full rather than by prefix. A row the practice
    // typed themselves must not be swept up by a correction aimed elsewhere.
    const db = seeded();
    run(db);
    expect(count(db,
      `SELECT COUNT(*) AS n FROM clients
        WHERE current_visa_type = 'Work Visa - Accredited Employer Work Visa (old)'`)).toBe(1);
  });

  it('leaves nothing behind that is not in the list', () => {
    // The whole point: after this, every stored value is a key the practice's
    // own list carries. Checked against the list rather than against a
    // hand-written set, so it cannot drift from what the register offers.
    const db = seeded();
    run(db);
    const list = (db.prepare("SELECT value AS v FROM settings WHERE key='vocab.visa_types'")
      .get() as { v: string }).v;
    const keys = new Set(list.split(/\r?\n/).filter((l) => l.includes('|'))
      .map((l) => l.split('|')[0]!.trim()));
    const used = (db.prepare(
      `SELECT DISTINCT current_visa_type AS k FROM clients
        WHERE current_visa_type IS NOT NULL AND current_visa_type <> ''`).all() as Array<{ k: string }>)
      .map((r) => r.k)
      .filter((k) => k !== 'Work Visa - Accredited Employer Work Visa (old)');
    for (const k of used) expect(keys.has(k), `${k} is not in the practice's visa list`).toBe(true);
  });
});

describe('the three seasonal visas', () => {
  it('are added, and the RSE one is kept rather than replaced', () => {
    const db = seeded();
    run(db);
    const list = (db.prepare("SELECT value AS v FROM settings WHERE key='vocab.visa_types'")
      .get() as { v: string }).v;
    for (const k of ['wv_aewv_psv', 'wv_aewv_gws', 'wv_aewv_seasonal']) {
      expect(list, k).toContain(k);
    }
    // RSE is a different scheme, and nothing here deletes a line.
    expect(list).toContain('wv_seasonal | WV. Seasonal (RSE)');
  });

  it('does not touch a list the practice has edited themselves', () => {
    // Issue 15: this register carries lines the practice added to two other
    // lists. A migration that rewrote a customised vocabulary would take them.
    const mine = 'wv_aewv | WV. AEWV\nmy_own | A line I added myself';
    const db = seeded({ list: mine });
    run(db);
    expect((db.prepare("SELECT value AS v FROM settings WHERE key='vocab.visa_types'")
      .get() as { v: string }).v).toBe(mine);
  });
});
