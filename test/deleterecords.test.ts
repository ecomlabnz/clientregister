/**
 * Removing a record that should never have existed.
 *
 * **Asked for on 9 September 2026:** *"owner must be able to delete a case - i
 * have just created one - a duplicate!"*, then *"the same for clients - must be
 * able to delete"*. An intake that ran twice had left a duplicate matter and
 * three empty people, and there was no way to remove any of them: the database
 * has audited case deletion since migration 0031 and that trigger had never
 * once fired, because no route in the application could delete a matter.
 *
 * The rules are in migration 0076, in the database, so a second route cannot
 * forget them. These tests therefore attack the database directly *and* go
 * through the handlers — the first proves the rule, the second proves the way
 * in is wired to it.
 *
 * The rule that matters most is the one about notes: `entries` are append-only
 * and cannot be deleted, so a matter's timeline is **re-filed onto the client**
 * rather than destroyed. That was found by rehearsing the migration, not by
 * reasoning about it — the first version tried to delete the notes and the
 * whole deletion was refused.
 */

import { describe, expect, it } from 'vitest';
import { casesModule } from '../src/modules/cases';
import { clientsModule } from '../src/modules/clients';
import { fakeUser, mountModule, type Harness } from './support/d1';

const at = '2026-09-09T00:00:00Z';

function seed(h: Harness) {
  h.db.exec(`
    INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at, updated_at)
      VALUES ('u_test', 'tester@example.test', 'A Tester', 'x', 'owner', '${at}', '${at}');
    INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
      VALUES ('cl_1', 'CL-0001', 'individual', 'Duc Manh BUI', 'active', '${at}', '${at}');
    INSERT INTO clients (id, ref, kind, full_name, status, created_at, updated_at)
      VALUES ('cl_2', 'CL-0002', 'individual', 'Minh Duc TRAN', 'active', '${at}', '${at}');
    INSERT INTO cases (id, ref, client_id, title, case_type, status, assigned_to, created_at, updated_at)
      VALUES ('k_1', 'CASE-26-001', 'cl_1', 'RV. Partner', 'rv_partnership', 'engaged', 'u_test', '${at}', '${at}');
    INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at, created_by)
      VALUES ('e_note', 'case', 'k_1', 'note', 'The consultation, written up.', '${at}', '${at}', 'u_test');
    INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
      VALUES ('e_sys', 'case', 'k_1', 'system', 'Case opened.', '${at}', '${at}');
    INSERT INTO tasks (id, title, status, assigned_to, entity_type, entity_id, created_at, updated_at)
      VALUES ('t_1', 'Chase INZ', 'open', 'u_test', 'case', 'k_1', '${at}', '${at}');
    INSERT INTO case_parties (id, case_id, client_id, role, created_at)
      VALUES ('p_1', 'k_1', 'cl_2', 'partner', '${at}');
    INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
      VALUES ('fl_1', 'case', 'k_1', 'immigration', 'Watch this.', '${at}', '${at}');
  `);
}

const owner = () => fakeUser({ role: 'owner' });

async function del(h: Harness, path: string, ref: string) {
  return h.post(path, { confirm_ref: ref });
}

describe('a matter made by mistake can be removed', () => {
  it('goes, and takes its tasks, parties and flags with it', async () => {
    const h = mountModule(casesModule, { user: owner() });
    seed(h);
    expect(await del(h, '/cases/k_1/delete', 'CASE-26-001')).toHaveProperty("status", 303);

    expect(h.count(`SELECT COUNT(*) AS n FROM cases WHERE id = 'k_1'`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM tasks WHERE entity_id = 'k_1'`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM case_parties WHERE case_id = 'k_1'`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM flags WHERE entity_id = 'k_1'`)).toBe(0);
  });

  it('re-files the timeline onto the client rather than destroying it', async () => {
    const h = mountModule(casesModule, { user: owner() });
    seed(h);
    await del(h, '/cases/k_1/delete', 'CASE-26-001');

    // The words are untouched and the note is now the person's.
    const note = h.get<{ entity_type: string; entity_id: string; body: string }>(
      `SELECT entity_type, entity_id, body FROM entries WHERE id = 'e_note'`);
    expect(note).toEqual({
      entity_type: 'client', entity_id: 'cl_1', body: 'The consultation, written up.',
    });
  });

  it('writes a note on the client saying what was removed', async () => {
    const h = mountModule(casesModule, { user: owner() });
    seed(h);
    await del(h, '/cases/k_1/delete', 'CASE-26-001');

    const said = h.get<{ body: string }>(
      `SELECT body FROM entries WHERE entity_type = 'client' AND entity_id = 'cl_1'
        AND body LIKE '%was deleted by%'`);
    expect(said?.body).toContain('CASE-26-001');
    expect(said?.body).toContain('A Tester');
    expect(said?.body).toContain('retired');
  });

  it('is recorded twice over: by the database, and by the handler', async () => {
    const h = mountModule(casesModule, { user: owner() });
    seed(h);
    await del(h, '/cases/k_1/delete', 'CASE-26-001');

    // The database's own row, which no route can skip. It had never fired
    // before this release — nothing could delete a matter.
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'case.deleted'`)).toBe(1);
    // And the handler's, which knows who pressed it and what it cost.
    const rich = h.get<{ meta_json: string }>(
      `SELECT meta_json FROM audit_log WHERE action = 'case.deleted_by_hand'`);
    expect(JSON.parse(rich!.meta_json)).toMatchObject({ ref: 'CASE-26-001', entries: 2, tasks: 1, parties: 1 });
  });

  for (const [what, sql, expected] of [
    ['an invoice', `INSERT INTO invoices (id, ref, client_id, case_id, description, created_at, updated_at)
                    VALUES ('i_1', 'INV-001', 'cl_1', 'k_1', 'Work', '${at}', '${at}')`, /invoice has to say/i],
    ['a quotation already sent', `INSERT INTO quotes (id, ref, client_id, case_id, description, amount_cents, status, created_at, updated_at)
                    VALUES ('q_1', 'Q-001', 'cl_1', 'k_1', 'Fee', 100, 'sent', '${at}', '${at}')`, /already gone to the client/i],
    ['documents', `INSERT INTO documents (id, entity_type, entity_id, r2_key, filename, content_type, size_bytes, uploaded_at)
                    VALUES ('d_1', 'case', 'k_1', 'k/1', 'a.pdf', 'application/pdf', 1, '${at}')`, /nothing pointing at them/i],
  ] as const) {
    it(`refuses a matter carrying ${what}, and says what to do instead`, async () => {
      const h = mountModule(casesModule, { user: owner() });
      seed(h);
      h.db.exec(sql);

      const res = await del(h, '/cases/k_1/delete', 'CASE-26-001');
      expect(res.status).toBe(303);
      // The database's own sentence reaches the person, not a stack trace.
      expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(expected);
      expect(h.count(`SELECT COUNT(*) AS n FROM cases WHERE id = 'k_1'`)).toBe(1);
      // And nothing was half-done on the way to being refused.
      expect(h.count(`SELECT COUNT(*) AS n FROM tasks WHERE entity_id = 'k_1'`)).toBe(1);
      expect(h.get<{ entity_type: string }>(
        `SELECT entity_type FROM entries WHERE id = 'e_note'`)?.entity_type).toBe('case');
    });
  }

  it('lets a draft quotation go, detached rather than deleted', async () => {
    const h = mountModule(casesModule, { user: owner() });
    seed(h);
    h.db.exec(`INSERT INTO quotes (id, ref, client_id, case_id, description, amount_cents, status, created_at, updated_at)
               VALUES ('q_d', 'Q-002', 'cl_1', 'k_1', 'Draft', 100, 'draft', '${at}', '${at}')`);

    await del(h, '/cases/k_1/delete', 'CASE-26-001');
    expect(h.get<{ case_id: string | null }>(`SELECT case_id FROM quotes WHERE id = 'q_d'`))
      .toEqual({ case_id: null });
  });
});

describe('a client made by mistake can be removed', () => {
  it('goes when nothing has been written about them', async () => {
    const h = mountModule(clientsModule, { user: owner() });
    seed(h);
    h.db.exec(`DELETE FROM case_parties; DELETE FROM cases WHERE client_id = 'cl_2';`);
    h.db.exec(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
               VALUES ('e_c', 'client', 'cl_2', 'system', 'Created by the intake.', '${at}', '${at}')`);

    expect((await del(h, '/clients/cl_2/delete', 'CL-0002')).status).toBe(303);
    expect(h.count(`SELECT COUNT(*) AS n FROM clients WHERE id = 'cl_2'`)).toBe(0);
    // The register's own bookkeeping goes; nothing a person wrote ever could.
    expect(h.count(`SELECT COUNT(*) AS n FROM entries WHERE entity_id = 'cl_2'`)).toBe(0);
    expect(h.count(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'client.deleted'`)).toBe(1);
  });

  it('refuses a client who has matters, naming that first', async () => {
    const h = mountModule(clientsModule, { user: owner() });
    seed(h);
    const res = await del(h, '/clients/cl_1/delete', 'CL-0001');
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/has matters/i);
    expect(h.count(`SELECT COUNT(*) AS n FROM clients WHERE id = 'cl_1'`)).toBe(1);
  });

  it('refuses a client somebody has written a note about', async () => {
    const h = mountModule(clientsModule, { user: owner() });
    seed(h);
    // Everything else cleared, so it is the note that refuses and not the
    // matters — the first version of this test proved the matters rule twice
    // and the note rule not at all.
    h.db.exec(`DELETE FROM case_parties; DELETE FROM cases;
               INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at, created_by)
                 VALUES ('e_x', 'client', 'cl_2', 'note', 'Spoke to them.', '${at}', '${at}', 'u_test')`);

    const res = await del(h, '/clients/cl_2/delete', 'CL-0002');
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/archive them instead/i);
    expect(h.count(`SELECT COUNT(*) AS n FROM clients WHERE id = 'cl_2'`)).toBe(1);
    expect(h.count(`SELECT COUNT(*) AS n FROM entries WHERE id = 'e_x'`)).toBe(1);
  });

  it('refuses somebody named on another person’s matter', async () => {
    const h = mountModule(clientsModule, { user: owner() });
    seed(h);
    const res = await del(h, '/clients/cl_2/delete', 'CL-0002');
    expect(decodeURIComponent(res.headers.get('location') ?? '')).toMatch(/named on another matter/i);
    expect(h.count(`SELECT COUNT(*) AS n FROM clients WHERE id = 'cl_2'`)).toBe(1);
  });
});

describe('the confirmation is not decoration', () => {
  it('refuses without the reference typed exactly', async () => {
    for (const typed of ['', 'case-26-002', 'yes', 'CASE-26-00']) {
      const h = mountModule(casesModule, { user: owner() });
      seed(h);
      const res = await h.post('/cases/k_1/delete', { confirm_ref: typed });
      expect(decodeURIComponent(res.headers.get('location') ?? ''), typed).toMatch(/Type CASE-26-001 exactly/);
      expect(h.count(`SELECT COUNT(*) AS n FROM cases WHERE id = 'k_1'`), typed).toBe(1);
    }
  });

  it('accepts it in either case, since a reference is not a password', async () => {
    const h = mountModule(casesModule, { user: owner() });
    seed(h);
    await h.post('/cases/k_1/delete', { confirm_ref: ' case-26-001 ' });
    expect(h.count(`SELECT COUNT(*) AS n FROM cases WHERE id = 'k_1'`)).toBe(0);
  });
});

describe('who may delete', () => {
  for (const role of ['adviser', 'assistant', 'readonly'] as const) {
    it(`refuses ${role}, for both`, async () => {
      const kases = mountModule(casesModule, { user: fakeUser({ role }) });
      seed(kases);
      expect((await del(kases, '/cases/k_1/delete', 'CASE-26-001')).status).toBe(403);
      expect(kases.count(`SELECT COUNT(*) AS n FROM cases WHERE id = 'k_1'`)).toBe(1);

      const people = mountModule(clientsModule, { user: fakeUser({ role }) });
      seed(people);
      expect((await del(people, '/clients/cl_1/delete', 'CL-0001')).status).toBe(403);
    });
  }

  for (const role of ['owner', 'admin'] as const) {
    it(`allows ${role}`, async () => {
      const h = mountModule(casesModule, { user: fakeUser({ role }) });
      seed(h);
      expect((await del(h, '/cases/k_1/delete', 'CASE-26-001')).status).toBe(303);
      expect(h.count(`SELECT COUNT(*) AS n FROM cases WHERE id = 'k_1'`)).toBe(0);
    });
  }

  it('shows the button to those two and nobody else', async () => {
    for (const role of ['owner', 'admin', 'adviser', 'assistant', 'readonly'] as const) {
      const h = mountModule(casesModule, { user: fakeUser({ role }) });
      seed(h);
      const body = await (await h.request('/cases/k_1/edit')).text();
      expect(body.includes('Delete this matter'), role).toBe(role === 'owner' || role === 'admin');
    }
  });
});

describe('what a note may never do, still', () => {
  it('cannot be edited, deleted, or re-filed onto nobody', () => {
    const h = mountModule(casesModule, { user: owner() });
    seed(h);
    expect(() => h.db.exec(`UPDATE entries SET body = 'tidier' WHERE id = 'e_note'`))
      .toThrow(/append-only/);
    expect(() => h.db.exec(`DELETE FROM entries WHERE id = 'e_note'`)).toThrow(/append-only/);
    expect(() => h.db.exec(
      `UPDATE entries SET entity_type = 'client', entity_id = 'nobody' WHERE id = 'e_note'`))
      .toThrow(/client who exists/);
  });
});
