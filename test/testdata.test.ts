/**
 * A quotation the practice is only testing with.
 *
 * **Asked for on 11 September 2026**, looking at two accepted quotations:
 * *"these two are test ones, can you mark them so that I can reinstate them to
 * unaccepted state to test? so i can send them and accept them many times -
 * because i need to test the system."*
 *
 * The danger in "let me un-accept this" is that it becomes a way to alter a
 * real contract after a client has signed it — the exact fault migration 0079
 * was written to stop. So the flag is a one-way door, and these tests attack
 * the database directly rather than going through the application: a guarantee
 * that only holds when the route remembers to check is not a guarantee.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { listTestData, tallyTestData } from '../src/core/testdata';
import { fakeD1 } from './support/d1';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const AT = '2026-09-01T00:00:00.000Z';
const ACCEPTED = 'This quotation has been accepted by the client';

type Db = ReturnType<typeof register>;

function register() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  return db;
}

function aQuote(db: Db, id: string, rehearsal = false) {
  db.prepare(
    `INSERT INTO quotes (id, ref, description, amount_cents, gst_cents, disbursements_cents,
                         currency, status, issued_on, is_test, created_at, updated_at)
     VALUES (?, ?, 'A matter', 100000, 15000, 0, 'NZD', 'draft', '2026-09-01', ?, ?, ?)`,
  ).run(id, id.toUpperCase(), rehearsal ? 1 : 0, AT, AT);
}

function anItem(db: Db, quoteId: string, id: string) {
  db.prepare(
    `INSERT INTO quote_items (id, quote_id, kind, description, unit_amount_cents,
                              net_cents, gst_cents, gross_cents, position, created_at, updated_at)
     VALUES (?, ?, 'professional', 'Advice', 100000, 100000, 15000, 115000, 0, ?, ?)`,
  ).run(id, quoteId, AT, AT);
}

/**
 * Sent, then accepted — in the two statements the register itself uses.
 *
 * The acceptance and the status move together in one UPDATE, and they have to:
 * the moment `accepted_at` is set the status is frozen, so a second statement
 * setting `status = 'accepted'` is refused. `core/quotelink.ts` writes it as
 * one statement for that reason, and this mirrors it rather than inventing an
 * order the application never uses.
 */
function accept(db: Db, id: string) {
  db.prepare(`UPDATE quotes SET status = 'sent' WHERE id = ?`).run(id);
  db.prepare(
    `UPDATE quotes SET accepted_at = '2026-09-05T01:00:00.000Z', accepted_name = 'A Client',
            status = 'accepted'
      WHERE id = ?`).run(id);
}

const run = (db: Db, sql: string) => () => db.exec(sql);
const one = <T>(db: Db, sql: string) => (db.prepare(sql) as any).get() as T;

describe('a real accepted quotation is still a contract', () => {
  it('refuses to have its figures changed', () => {
    const db = register();
    aQuote(db, 'q1'); accept(db, 'q1');
    expect(run(db, `UPDATE quotes SET amount_cents = 1 WHERE id = 'q1'`)).toThrow(ACCEPTED);
  });

  it('refuses to have its status moved off accepted', () => {
    const db = register();
    aQuote(db, 'q1'); accept(db, 'q1');
    expect(run(db, `UPDATE quotes SET status = 'draft' WHERE id = 'q1'`)).toThrow(ACCEPTED);
  });

  it('refuses to have its acceptance cleared', () => {
    const db = register();
    aQuote(db, 'q1'); accept(db, 'q1');
    expect(run(db, `UPDATE quotes SET accepted_at = NULL, accepted_name = NULL WHERE id = 'q1'`))
      .toThrow('the moment a contract was formed');
  });

  it('refuses to have a fee line changed or removed', () => {
    const db = register();
    aQuote(db, 'q1'); anItem(db, 'q1', 'i1'); accept(db, 'q1');
    expect(run(db, `UPDATE quote_items SET net_cents = 1 WHERE id = 'i1'`)).toThrow(ACCEPTED);
    expect(run(db, `DELETE FROM quote_items WHERE id = 'i1'`)).toThrow(ACCEPTED);
  });
});

describe('a rehearsal can be run through the cycle again and again', () => {
  it('lets its acceptance be cleared and the status wound back', () => {
    const db = register();
    aQuote(db, 'q1'); accept(db, 'q1');
    db.exec(`UPDATE quotes SET is_test = 1 WHERE id = 'q1'`);

    db.exec(`UPDATE quotes SET accepted_at = NULL, accepted_name = NULL, status = 'draft' WHERE id = 'q1'`);
    const row = one<{ status: string; accepted_at: string | null }>(
      db, `SELECT status, accepted_at FROM quotes WHERE id = 'q1'`);
    expect(row.status).toBe('draft');
    expect(row.accepted_at).toBeNull();
  });

  it('survives the whole round trip more than once', () => {
    // Which is the thing that was asked for: "send them and accept them many
    // times".
    const db = register();
    aQuote(db, 'q1', true);
    for (let round = 0; round < 3; round += 1) {
      accept(db, 'q1');
      expect(one<{ status: string }>(db, `SELECT status FROM quotes WHERE id = 'q1'`).status)
        .toBe('accepted');
      db.exec(`UPDATE quotes SET accepted_at = NULL, accepted_name = NULL, status = 'draft' WHERE id = 'q1'`);
    }
  });

  it('lets its fee lines be changed and removed again', () => {
    const db = register();
    aQuote(db, 'q1', true); anItem(db, 'q1', 'i1'); accept(db, 'q1');
    db.exec(`UPDATE quote_items SET net_cents = 200000 WHERE id = 'i1'`);
    db.exec(`DELETE FROM quote_items WHERE id = 'i1'`);
    expect(one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM quote_items`).n).toBe(0);
  });

  it('can be marked even after it has already been accepted', () => {
    // The two quotations that prompted this were already accepted. A rule that
    // could not reach them would not have answered the question.
    const db = register();
    aQuote(db, 'q1'); accept(db, 'q1');
    db.exec(`UPDATE quotes SET is_test = 1 WHERE id = 'q1'`);
    expect(one<{ is_test: number }>(
      db, `SELECT is_test FROM quotes WHERE id = 'q1'`).is_test).toBe(1);
  });
});

describe('the door only opens one way', () => {
  it('never lets a rehearsal become a real contract again', () => {
    // This is the whole safety of the feature. Marking a quotation a rehearsal
    // destroys it as a contract permanently, so unlocking a real one this way
    // is a worse outcome for whoever does it than leaving it alone.
    const db = register();
    aQuote(db, 'q1', true);
    expect(run(db, `UPDATE quotes SET is_test = 0 WHERE id = 'q1'`))
      .toThrow('test data cannot become a real contract');
  });

  it('refuses even when the same statement changes something else too', () => {
    const db = register();
    aQuote(db, 'q1', true);
    expect(run(db, `UPDATE quotes SET is_test = 0, description = 'Else' WHERE id = 'q1'`))
      .toThrow('test data cannot become a real contract');
  });

  it('refuses on an accepted rehearsal as well', () => {
    const db = register();
    aQuote(db, 'q1'); accept(db, 'q1');
    db.exec(`UPDATE quotes SET is_test = 1 WHERE id = 'q1'`);
    expect(run(db, `UPDATE quotes SET is_test = 0 WHERE id = 'q1'`))
      .toThrow('test data cannot become a real contract');
  });

  it('takes nothing but 0 or 1', () => {
    const db = register();
    aQuote(db, 'q1');
    expect(run(db, `UPDATE quotes SET is_test = 2 WHERE id = 'q1'`)).toThrow();
  });

  it('starts every quotation as a real one', () => {
    const db = register();
    aQuote(db, 'q1');
    expect(one<{ is_test: number }>(
      db, `SELECT is_test FROM quotes WHERE id = 'q1'`).is_test).toBe(0);
  });
});

describe('a rehearsal is a quotation with fewer locks, not with no rules', () => {
  it('still refuses an acceptance with a time but no name', () => {
    const db = register();
    aQuote(db, 'q1', true);
    db.exec(`UPDATE quotes SET status = 'sent' WHERE id = 'q1'`);
    expect(run(db, `UPDATE quotes SET accepted_at = '2026-09-05T01:00:00.000Z' WHERE id = 'q1'`))
      .toThrow('records who accepted and when, or neither');
  });

  it('still refuses to be accepted before it has been sent', () => {
    const db = register();
    aQuote(db, 'q1', true);
    expect(run(db,
      `UPDATE quotes SET accepted_at = '2026-09-05T01:00:00.000Z', accepted_name = 'A' WHERE id = 'q1'`))
      .toThrow('only a quotation that has been sent can be accepted');
  });
});

/**
 * The mark travels down a file, and only down.
 *
 * The practice chose this: *"everything under them becomes test too"*. It is
 * also the only version in which the delete can be what was asked for —
 * *"without any further questions"* — because nothing is left half-real
 * underneath a deleted client.
 */
function aClient(db: Db, id: string, test = false) {
  db.prepare(
    `INSERT INTO clients (id, ref, kind, full_name, status, is_test, created_at, updated_at)
     VALUES (?, ?, 'individual', 'A Person', 'active', ?, ?, ?)`,
  ).run(id, id.toUpperCase(), test ? 1 : 0, AT, AT);
}

function aUser(db: Db) {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, name, password_hash, role, status, created_at, updated_at)
     VALUES ('u1', 'tester@example.test', 'A Tester', 'x', 'admin', 'active', ?, ?)`).run(AT, AT);
}

/** Every matter must be assigned to somebody — a rule of its own, since 0021. */
function aCase(db: Db, id: string, clientId: string) {
  aUser(db);
  db.prepare(
    `INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to, created_at, updated_at)
     VALUES (?, ?, ?, 'A matter', 'other_other', 'open', 'u1', ?, ?)`,
  ).run(id, id.toUpperCase(), clientId, AT, AT);
}

const isTest = (db: Db, table: string, id: string) =>
  one<{ is_test: number }>(db, `SELECT is_test FROM ${table} WHERE id = '${id}'`).is_test;

describe('marking a client marks their whole file', () => {
  it('sweeps the cases, quotations, inquiries and invoices already filed', () => {
    const db = register();
    aClient(db, 'c1');
    aCase(db, 'k1', 'c1');
    db.prepare(
      `INSERT INTO quotes (id, ref, description, amount_cents, gst_cents, disbursements_cents,
                           currency, status, issued_on, client_id, created_at, updated_at)
       VALUES ('q1','Q1','A matter',1,0,0,'NZD','draft','2026-09-01','c1',?,?)`).run(AT, AT);
    db.prepare(
      `INSERT INTO inquiries (id, ref, source, received_at, client_id, created_at, updated_at)
       VALUES ('n1','N1','web',?,'c1',?,?)`).run(AT, AT, AT);

    db.exec(`UPDATE clients SET is_test = 1 WHERE id = 'c1'`);

    expect(isTest(db, 'cases', 'k1')).toBe(1);
    expect(isTest(db, 'quotes', 'q1')).toBe(1);
    expect(isTest(db, 'inquiries', 'n1')).toBe(1);
  });

  it('marks a case filed under them afterwards', () => {
    const db = register();
    aClient(db, 'c1', true);
    aCase(db, 'k1', 'c1');
    expect(isTest(db, 'cases', 'k1')).toBe(1);
  });

  it('marks a quotation raised on them afterwards', () => {
    const db = register();
    aClient(db, 'c1', true);
    db.prepare(
      `INSERT INTO quotes (id, ref, description, amount_cents, gst_cents, disbursements_cents,
                           currency, status, issued_on, client_id, created_at, updated_at)
       VALUES ('q1','Q1','A matter',1,0,0,'NZD','draft','2026-09-01','c1',?,?)`).run(AT, AT);
    expect(isTest(db, 'quotes', 'q1')).toBe(1);
  });

  it('reaches a quotation through the case as well as through the client', () => {
    const db = register();
    aClient(db, 'c1');
    aCase(db, 'k1', 'c1');
    db.prepare(
      `INSERT INTO quotes (id, ref, description, amount_cents, gst_cents, disbursements_cents,
                           currency, status, issued_on, case_id, created_at, updated_at)
       VALUES ('q1','Q1','A matter',1,0,0,'NZD','draft','2026-09-01','k1',?,?)`).run(AT, AT);
    db.exec(`UPDATE cases SET is_test = 1 WHERE id = 'k1'`);
    expect(isTest(db, 'quotes', 'q1')).toBe(1);
    // And not upward: the client is untouched.
    expect(isTest(db, 'clients', 'c1')).toBe(0);
  });

  it('never travels upward from a quotation to its client', () => {
    // Which is what makes the mark usable on a real client's file — the two
    // quotations that prompted this sit on real clients.
    const db = register();
    aClient(db, 'c1');
    db.prepare(
      `INSERT INTO quotes (id, ref, description, amount_cents, gst_cents, disbursements_cents,
                           currency, status, issued_on, client_id, created_at, updated_at)
       VALUES ('q1','Q1','A matter',1,0,0,'NZD','draft','2026-09-01','c1',?,?)`).run(AT, AT);
    db.exec(`UPDATE quotes SET is_test = 1 WHERE id = 'q1'`);
    expect(isTest(db, 'clients', 'c1')).toBe(0);
  });

  it('lifts again from a client, because only a quotation is one-way', () => {
    const db = register();
    aClient(db, 'c1');
    db.exec(`UPDATE clients SET is_test = 1 WHERE id = 'c1'`);
    db.exec(`UPDATE clients SET is_test = 0 WHERE id = 'c1'`);
    expect(isTest(db, 'clients', 'c1')).toBe(0);
  });
});

describe('a file note goes only with the test record it belongs to', () => {
  const aNote = (db: Db, id: string, entityType: string, entityId: string) =>
    db.prepare(
      `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
       VALUES (?, ?, ?, 'note', 'Said something', ?, ?)`).run(id, entityType, entityId, AT, AT);

  it('still refuses to delete a note on a real file', () => {
    // The standing rule is unchanged: a note records what was said at the time.
    const db = register();
    aClient(db, 'c1');
    aNote(db, 'e1', 'client', 'c1');
    expect(run(db, `DELETE FROM entries WHERE id = 'e1'`))
      .toThrow('a note cannot be deleted');
  });

  it('lets a note on a test client go', () => {
    // A purge that deleted the client and left their notes behind would leave
    // loose client-shaped text with nothing to say whose it was.
    const db = register();
    aClient(db, 'c1', true);
    aNote(db, 'e1', 'client', 'c1');
    db.exec(`DELETE FROM entries WHERE id = 'e1'`);
    expect(one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM entries`).n).toBe(0);
  });

  it('refuses again the moment the mark is lifted', () => {
    const db = register();
    aClient(db, 'c1', true);
    aNote(db, 'e1', 'client', 'c1');
    db.exec(`UPDATE clients SET is_test = 0 WHERE id = 'c1'`);
    expect(run(db, `DELETE FROM entries WHERE id = 'e1'`)).toThrow('a note cannot be deleted');
  });

  it('still refuses a note filed against something that is not there', () => {
    const db = register();
    aNote(db, 'e1', 'client', 'gone');
    expect(run(db, `DELETE FROM entries WHERE id = 'e1'`)).toThrow('a note cannot be deleted');
  });
});

/**
 * The application side: who may mark, and where the mark is offered.
 *
 * The rules are the database's (above). These check the parts that genuinely
 * are application work — the permission, and that every kind of record offers
 * the mark in the same place and the same way.
 */
describe('only an administrator or owner may mark test data', () => {
  const rbac = readFileSync('src/core/rbac.ts', 'utf8');

  it('gives the permission to the owner and the administrator and nobody else', () => {
    // *"no one but the admin or owner - which are the same - can mark data as
    // test."* The owner has every permission by definition; the administrator
    // is named explicitly. An adviser, an assistant and a read-only account
    // must not be able to mark a client for deletion.
    expect(rbac).toContain("'data:test'");
    const adviser = rbac.slice(rbac.indexOf('adviser: ['), rbac.indexOf('assistant: ['));
    const assistant = rbac.slice(rbac.indexOf('assistant: ['), rbac.indexOf('readonly: ['));
    const readonly = rbac.slice(rbac.indexOf('readonly: ['));
    for (const [name, block] of [['adviser', adviser], ['assistant', assistant], ['readonly', readonly]]) {
      expect(block, `${name} must not be able to mark test data`).not.toContain("'data:test'");
    }
    const admin = rbac.slice(rbac.indexOf('admin: ['), rbac.indexOf('adviser: ['));
    expect(admin).toContain("'data:test'");
  });

  it('guards both the mark and the delete with it', () => {
    const admin = readFileSync('src/modules/admin/index.ts', 'utf8');
    expect(admin).toContain("r.post('/test-data/mark', requirePermission('data:test')");
    expect(admin).toContain("r.post('/test-data/delete', requirePermission('data:test')");
    expect(admin).toContain("r.get('/test-data', requirePermission('data:test')");
  });

  it('guards unaccepting a test quotation with it too', () => {
    const quotes = readFileSync('src/modules/quotes/index.ts', 'utf8');
    expect(quotes).toContain("r.post('/:id/reopen', requirePermission('data:test')");
  });
});

describe('every kind of record offers the mark the same way', () => {
  const modules: Array<[string, string]> = [
    ['clients', 'src/modules/clients/index.ts'],
    ['cases', 'src/modules/cases/index.ts'],
    ['quotes', 'src/modules/quotes/index.ts'],
    ['inquiries', 'src/modules/inquiries/index.ts'],
    ['invoices', 'src/modules/invoices/index.ts'],
    ['tasks', 'src/modules/tasks/index.ts'],
  ];

  it.each(modules)('%s shows the band on its record page', (table, path) => {
    const src = readFileSync(path, 'utf8');
    expect(src).toContain('testDataBand({');
    expect(src).toContain(`table: '${table}'`);
  });

  it('sends every one of them to the single mark route', () => {
    // One route rather than six: six would be six permission checks to keep in
    // step, and this is the permission that authorises a delete.
    const components = readFileSync('src/ui/components.ts', 'utf8');
    expect(components).toContain("const action = '/admin/test-data/mark';");
  });

  it('marks a quotation one-way and nothing else', () => {
    const quotes = readFileSync('src/modules/quotes/index.ts', 'utf8');
    expect(quotes).toContain('oneWay: true');
    for (const [, path] of modules.filter(([t]) => t !== 'quotes')) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('oneWay: true');
    }
  });
});

/**
 * The list screen reads a different column from every one of the tables.
 *
 * This is the test the practice paid for: clicking **Test data** with a matter
 * marked gave *Something went wrong*, because the list asked every table it had
 * not named by hand for a `description` column, and a matter has a `title`.
 * Marking one row in each table and reading the list back is the only shape of
 * test that catches it — a test that marks a client alone passes while five
 * other tables are wrong.
 */
describe('the list of marked records reads every table', () => {
  it('names one marked row from each of them', async () => {
    const db = register();
    aUser(db);
    aClient(db, 'c1');
    aCase(db, 'k1', 'c1');
    aQuote(db, 'q1', true);
    db.prepare(
      `INSERT INTO inquiries (id, ref, source, received_at, subject, is_test, created_at, updated_at)
       VALUES ('n1','N1','web',?,'An asking',1,?,?)`).run(AT, AT, AT);
    db.prepare(
      `INSERT INTO invoices (id, ref, description, status, is_test, created_at, updated_at)
       VALUES ('i1','I1','Work done','draft',1,?,?)`).run(AT, AT);
    db.prepare(
      `INSERT INTO tasks (id, title, assigned_to, is_test, created_at, updated_at)
       VALUES ('t1','Ring them back','u1',1,?,?)`).run(AT, AT);
    // Added 12 September 2026 with migration 0096, when the demonstration
    // caseload gained knowledge base articles and the reset had to be able to
    // take them out again.
    db.prepare(
      `INSERT INTO kb_articles (id, ref, kind, title, body, status, is_test, created_at, updated_at)
       VALUES ('a1','A1','guide','A written-down thing','body','draft',1,?,?)`).run(AT, AT);
    db.exec(`UPDATE clients SET is_test = 1 WHERE id = 'c1'`);

    const env = { DB: fakeD1(db) } as unknown as Parameters<typeof listTestData>[0];
    const records = await listTestData(env);

    const seen = (t: string) => records.find((r) => r.table === t)!;
    expect(records.map((r) => r.table).sort())
      .toEqual(['cases', 'clients', 'inquiries', 'invoices', 'kb_articles', 'quotes', 'tasks']);
    expect(seen('clients').title).toBe('A Person');
    expect(seen('cases').title).toBe('A matter');
    expect(seen('quotes').title).toBe('A matter');
    expect(seen('inquiries').title).toBe('An asking');
    expect(seen('invoices').title).toBe('Work done');
    expect(seen('tasks').title).toBe('Ring them back');
    // A task has no reference number of its own, and must not claim one.
    expect(seen('tasks').ref).toBe('');
    expect(seen('cases').ref).toBe('K1');
    expect(seen('kb_articles').title).toBe('A written-down thing');
  });

  it('counts the same tables', async () => {
    const db = register();
    aQuote(db, 'q1', true);
    const env = { DB: fakeD1(db) } as unknown as Parameters<typeof tallyTestData>[0];
    const tally = await tallyTestData(env);
    expect(tally.map((t) => t.table).sort())
      .toEqual(['cases', 'clients', 'inquiries', 'invoices', 'kb_articles', 'quotes', 'tasks']);
    expect(tally.find((t) => t.table === 'quotes')?.count).toBe(1);
  });
});

/**
 * A rehearsal can be taken back out, and a real record still cannot.
 *
 * **Migration 0096**, written on 12 September 2026 when the demonstration
 * caseload gained invoices. Migration 0083 already let an administrator mark an
 * invoice as test data and already put `invoices` in the purge's delete order —
 * but `invoices_cannot_be_deleted` refused every delete, so the first purge
 * with a marked invoice in it would have aborted. Nobody had hit it, because
 * nothing yet wrote one.
 *
 * Attacked directly rather than through the application, because the guarantee
 * is a trigger and a route that remembers to check is not a guarantee.
 */
describe('a marked invoice can be deleted and a real one cannot', () => {
  function anInvoice(db: Db, id: string, rehearsal: boolean, status = 'issued') {
    db.prepare(
      `INSERT INTO invoices (id, ref, client_id, description, status, is_test,
                             payment_terms_days, created_at, updated_at)
       VALUES (?, ?, 'c1', 'Work done', 'draft', ?, 7, ?, ?)`,
    ).run(id, id.toUpperCase(), rehearsal ? 1 : 0, AT, AT);
    db.prepare(
      `INSERT INTO invoice_items (id, invoice_id, position, description, kind, unit_label,
              quantity_milli, unit_amount_cents, gst_treatment, gst_rate_bp,
              net_cents, gst_cents, gross_cents, created_at)
       VALUES (?, ?, 0, 'Advice', 'professional', 'item', 1000, 100000,
               'exclusive', 1500, 100000, 15000, 115000, ?)`,
    ).run(`li_${id}`, id, AT);
    if (status !== 'draft') {
      db.prepare(
        `UPDATE invoices SET status = ?, issued_on = '2026-08-01', due_on = '2026-08-08',
                net_cents = 100000, gst_cents = 15000, gross_cents = 115000 WHERE id = ?`,
      ).run(status, id);
    }
    db.prepare(
      `INSERT INTO invoice_payments (id, invoice_id, paid_on, amount_cents, method,
                                     created_at, created_by)
       VALUES (?, ?, '2026-08-05', 50000, 'bank', ?, 'u1')`,
    ).run(`pay_${id}`, id, AT);
  }

  it('takes a marked invoice, its lines and its payments', () => {
    const db = register();
    aUser(db);
    aClient(db, 'c1');
    anInvoice(db, 'i1', true);
    db.exec(`DELETE FROM invoices WHERE is_test = 1`);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM invoices').n).toBe(0);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM invoice_items').n).toBe(0);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM invoice_payments').n).toBe(0);
  });

  it('still refuses to delete a real invoice', () => {
    const db = register();
    aUser(db);
    aClient(db, 'c1');
    anInvoice(db, 'i2', false);
    expect(run(db, `DELETE FROM invoices WHERE id = 'i2'`))
      .toThrow('an invoice cannot be deleted; void it instead');
  });

  it('still refuses to delete a payment on a real invoice', () => {
    const db = register();
    aUser(db);
    aClient(db, 'c1');
    anInvoice(db, 'i3', false);
    expect(run(db, `DELETE FROM invoice_payments WHERE id = 'pay_i3'`))
      .toThrow('a payment cannot be deleted');
  });

  it('still refuses to take a line off a real issued invoice', () => {
    const db = register();
    aUser(db);
    aClient(db, 'c1');
    anInvoice(db, 'i4', false);
    expect(run(db, `DELETE FROM invoice_items WHERE id = 'li_i4'`))
      .toThrow('an issued invoice cannot lose a line');
  });
});

describe('a knowledge base article can be a rehearsal too', () => {
  function anArticle(db: Db, id: string, rehearsal: boolean) {
    db.prepare(
      `INSERT INTO kb_articles (id, ref, kind, title, body, status, is_test,
                                created_at, updated_at)
       VALUES (?, ?, 'guide', 'A written-down thing', 'body', 'published', ?, ?, ?)`,
    ).run(id, id.toUpperCase(), rehearsal ? 1 : 0, AT, AT);
  }

  it('is deleted by the purge, and a real article is not', () => {
    const db = register();
    aUser(db);
    anArticle(db, 'a1', true);
    anArticle(db, 'a2', false);
    db.exec(`DELETE FROM kb_articles WHERE is_test = 1`);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM kb_articles').n).toBe(1);
  });

  it('makes the reminder it raises a rehearsal as well', () => {
    // Otherwise the follow-up task outlives the article it points at, every
    // time the caseload is put back.
    const db = register();
    aUser(db);
    anArticle(db, 'a1', true);
    db.prepare(
      `INSERT INTO tasks (id, title, status, priority, assigned_to, entity_type, entity_id,
                          created_at, updated_at)
       VALUES ('t1', 'KB-1 is due for review', 'open', 'normal', 'u1', 'kb_article', 'a1', ?, ?)`,
    ).run(AT, AT);
    expect(one<{ n: number }>(db, `SELECT is_test AS n FROM tasks WHERE id = 't1'`).n).toBe(1);
  });

  it('sweeps the reminders already raised when it is marked afterwards', () => {
    const db = register();
    aUser(db);
    anArticle(db, 'a1', false);
    db.prepare(
      `INSERT INTO tasks (id, title, status, priority, assigned_to, entity_type, entity_id,
                          created_at, updated_at)
       VALUES ('t1', 'KB-1 is due for review', 'open', 'normal', 'u1', 'kb_article', 'a1', ?, ?)`,
    ).run(AT, AT);
    expect(one<{ n: number }>(db, `SELECT is_test AS n FROM tasks WHERE id = 't1'`).n).toBe(0);
    db.exec(`UPDATE kb_articles SET is_test = 1 WHERE id = 'a1'`);
    expect(one<{ n: number }>(db, `SELECT is_test AS n FROM tasks WHERE id = 't1'`).n).toBe(1);
  });
});
