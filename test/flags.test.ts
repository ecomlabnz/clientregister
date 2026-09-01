/**
 * Warnings on a file.
 *
 * The practice asked for these on reading a partnership summary that recorded
 * an assault reported to Police: a fact that changes how a matter is handled,
 * with no column of its own, three screens down in a file note — something you
 * find after you needed it rather than before.
 *
 * Two rules carry the whole feature, and both are pinned here: a warning on a
 * person shows on their matters, and a warning can be given a life.
 */

import { describe, expect, it } from 'vitest';
import { migratedSqlite, mountModule, fakeUser } from './support/d1';
import { FLAG_LIVES, expiryFor, isShowing } from '../src/core/flags';
import { flagsModule } from '../src/modules/flags';
import { clientsModule } from '../src/modules/clients';
import { casesModule } from '../src/modules/cases';

const AT = '2026-09-01T00:00:00Z';
const USER = fakeUser();

function seed(db: any) {
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
              VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
              VALUES ('cl1','CL-1','individual','A PERSON','active',?,?)`).run(AT, AT);
  db.prepare(`INSERT INTO cases (id,ref,client_id,title,descriptor,case_type,status,assigned_to,
                                 created_at,updated_at)
              VALUES ('k1','CASE-1','cl1','A matter','A matter','wv_aewv','lodged',?,?,?)`)
    .run(USER.id, AT, AT);
}
const attempt = (db: any, sql: string, ...p: unknown[]) => {
  try { db.prepare(sql).run(...p); return null; } catch (e: any) { return e.message as string; }
};

describe('what the database will hold', () => {
  it('refuses a warning that says nothing', () => {
    // An empty band is worse than none: it teaches people to ignore the band.
    const db = migratedSqlite();
    seed(db);
    expect(attempt(db, `INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                        VALUES ('f1','client','cl1','safety','   ',?,?)`, AT, AT))
      .toMatch(/must say what it is warning about/);
  });

  it('refuses a warning on something that is neither a client nor a matter', () => {
    const db = migratedSqlite();
    seed(db);
    expect(attempt(db, `INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                        VALUES ('f1','quote','q1','safety','Something',?,?)`, AT, AT))
      .toMatch(/CHECK/);
  });

  it('refuses one cleared before it was raised', () => {
    const db = migratedSqlite();
    seed(db);
    db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                VALUES ('f1','client','cl1','safety','Something',?,?)`).run(AT, AT);
    expect(attempt(db, `UPDATE flags SET cleared_at = '2025-01-01T00:00:00Z' WHERE id='f1'`))
      .toMatch(/cannot be cleared before it was raised/);
  });

  it('takes a warning with the record it is about', () => {
    // Left behind it would warn about nothing, and the next record given that
    // id would inherit it.
    const db = migratedSqlite();
    seed(db);
    db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                VALUES ('f1','case','k1','safety','Something',?,?)`).run(AT, AT);
    db.prepare("DELETE FROM cases WHERE id='k1'").run();
    expect(db.prepare("SELECT id FROM flags WHERE id='f1'").all()).toEqual([]);
  });
});

describe('how long a warning stands', () => {
  it('stands until taken down when no period is chosen', () => {
    expect(expiryFor('standing')).toBeNull();
    expect(expiryFor(null)).toBeNull();
    expect(expiryFor('nonsense')).toBeNull();
  });

  it('takes its date from the period chosen', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(expiryFor('30', from)).toBe('2026-10-01');
    expect(expiryFor('365', from)).toBe('2027-09-01');
  });

  it('offers standing first, because that is what a warning usually is', () => {
    expect(FLAG_LIVES[0]!.value).toBe('standing');
    expect(FLAG_LIVES[0]!.days).toBeNull();
  });

  it('stops showing once its date has passed, without anybody taking it down', () => {
    const flag = { cleared_at: null, expires_on: '2026-08-31' };
    expect(isShowing(flag, '2026-08-31')).toBe(true);
    expect(isShowing(flag, '2026-09-01')).toBe(false);
  });

  it('stops showing once taken down, whatever its date said', () => {
    expect(isShowing({ cleared_at: AT, expires_on: '2099-01-01' }, '2026-09-01')).toBe(false);
  });
});

describe('raising and taking down through the register', () => {
  const mount = () => mountModule(flagsModule, { user: USER });
  const rows = (h: any) => h.db.prepare('SELECT * FROM flags').all() as any[];

  it('raises one, and it stands', async () => {
    const h = mount();
    seed(h.db);
    const res = await h.post('/flags', {
      entity_type: 'client', entity_id: 'cl1', kind: 'safety',
      body: 'Assaulted by a former husband, reported to Police', life: 'standing',
    });
    expect(res.status).toBe(303);
    const [flag] = rows(h);
    expect(flag.body).toBe('Assaulted by a former husband, reported to Police');
    expect(flag.expires_on).toBeNull();
    expect(flag.cleared_at).toBeNull();
  });

  it('refuses a kind that is not one of the practice’s own', async () => {
    // The kinds are vocabulary, so what is offered can change between the page
    // being drawn and the form coming back. A warning filed under a heading
    // nobody recognises is a warning nobody finds.
    const h = mount();
    seed(h.db);
    const res = await h.post('/flags', {
      entity_type: 'client', entity_id: 'cl1', kind: 'invented', body: 'Something',
    });
    expect(res.headers.get('location')).toContain('err=');
    expect(rows(h)).toEqual([]);
  });

  it('takes one down without deleting it, and keeps why', async () => {
    const h = mount();
    seed(h.db);
    await h.post('/flags', { entity_type: 'client', entity_id: 'cl1', kind: 'character',
                             body: 'Undisclosed conviction', life: 'standing' });
    const id = rows(h)[0]!.id;
    await h.post(`/flags/${id}/clear`, { note: 'Disclosed to INZ and accepted' });
    const [flag] = rows(h);
    expect(flag.cleared_at).toBeTruthy();
    expect(flag.cleared_note).toBe('Disclosed to INZ and accepted');
    expect(flag.body).toBe('Undisclosed conviction');
  });

  it('changes what one says, and the audit log keeps the old wording', async () => {
    const h = mount();
    seed(h.db);
    await h.post('/flags', { entity_type: 'client', entity_id: 'cl1', kind: 'character',
                             body: 'Convicted of somehting', life: 'standing' });
    const id = rows(h)[0]!.id;
    const res = await h.post(`/flags/${id}/edit`, {
      kind: 'safety', body: 'Convicted of assault, 2019. Disclosed.', life: 'standing',
    });
    expect(res.status).toBe(303);
    const [flag] = rows(h);
    expect(flag.body).toBe('Convicted of assault, 2019. Disclosed.');
    expect(flag.kind).toBe('safety');
    const audit = h.db.prepare("SELECT meta_json FROM audit_log WHERE action = 'flag.edited'").all() as any[];
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0]!.meta_json).was).toBe('Convicted of somehting');
  });

  it('refuses an edit into a kind that is not one of the practice’s own', async () => {
    const h = mount();
    seed(h.db);
    await h.post('/flags', { entity_type: 'client', entity_id: 'cl1', kind: 'safety',
                             body: 'Something real', life: 'standing' });
    const id = rows(h)[0]!.id;
    const res = await h.post(`/flags/${id}/edit`, { kind: 'invented', body: 'Something else' });
    expect(res.headers.get('location')).toContain('err=');
    expect(rows(h)[0]!.body).toBe('Something real');
  });

  it('refuses an edit that empties it', async () => {
    // A blank band is worse than none: it teaches people to look past the band.
    const h = mount();
    seed(h.db);
    await h.post('/flags', { entity_type: 'client', entity_id: 'cl1', kind: 'safety',
                             body: 'Something real', life: 'standing' });
    const id = rows(h)[0]!.id;
    await h.post(`/flags/${id}/edit`, { kind: 'safety', body: '   ' });
    expect(rows(h)[0]!.body).toBe('Something real');
  });

  it('deletes one outright, and what it said survives in the audit log', async () => {
    // Deleting is not taking down. One says "no longer true", the other says
    // "never belonged here" — a warning raised on the wrong person.
    const h = mount();
    seed(h.db);
    await h.post('/flags', { entity_type: 'client', entity_id: 'cl1', kind: 'character',
                             body: 'Raised on the wrong file', life: 'standing' });
    const id = rows(h)[0]!.id;
    const res = await h.post(`/flags/${id}/delete`, {});
    expect(res.status).toBe(303);
    expect(rows(h)).toEqual([]);
    const audit = h.db.prepare("SELECT meta_json FROM audit_log WHERE action = 'flag.deleted'").all() as any[];
    expect(JSON.parse(audit[0]!.meta_json).said).toBe('Raised on the wrong file');
  });

  it('refuses a reader who may not write to the register', async () => {
    // Changing or removing a warning is a change to the record, and the two new
    // ways of doing it must be gated exactly like raising one.
    const h = mountModule(flagsModule, { user: fakeUser({ role: 'readonly' }) });
    seed(h.db);
    h.db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                  VALUES ('f1','client','cl1','safety','Something real',?,?)`).run(AT, AT);
    for (const path of ['/flags/f1/edit', '/flags/f1/delete']) {
      const res = await h.post(path, { kind: 'safety', body: 'Changed by a reader' });
      expect(res.status).toBe(403);
    }
    // And the warning is exactly as it was, on the database the reader reached.
    expect(rows(h)).toHaveLength(1);
    expect(rows(h)[0]!.body).toBe('Something real');
  });

  it('puts one back, standing again', async () => {
    const h = mount();
    seed(h.db);
    await h.post('/flags', { entity_type: 'client', entity_id: 'cl1', kind: 'safety',
                             body: 'Something', life: '30' });
    const id = rows(h)[0]!.id;
    await h.post(`/flags/${id}/clear`, {});
    await h.post(`/flags/${id}/raise-again`, {});
    const [flag] = rows(h);
    expect(flag.cleared_at).toBeNull();
    expect(flag.expires_on).toBeNull();
  });
});

describe('where a warning shows', () => {
  it('a warning on a client shows at the top of their page', async () => {
    const h = mountModule(clientsModule, { user: USER });
    seed(h.db);
    h.db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                  VALUES ('f1','client','cl1','safety','Reported to Police',?,?)`).run(AT, AT);
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).toContain('class="flags"');
    expect(body).toContain('Reported to Police');
    // Above the record, not somewhere in it.
    expect(body.indexOf('class="flags"')).toBeLessThan(body.indexOf('class="cols"'));
  });

  it('shows nothing at all when there is nothing to warn about', async () => {
    // A band on every file teaches people to look past it.
    const h = mountModule(clientsModule, { user: USER });
    seed(h.db);
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).not.toContain('class="flags"');
  });

  it("a warning on a client shows on their matter too", async () => {
    // The rule the whole feature turns on. The fact is about the person, not
    // about one application, and a warning that has to be raised again on every
    // new file is a warning that stops being raised.
    const h = mountModule(casesModule, { user: USER });
    seed(h.db);
    h.db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                  VALUES ('f1','client','cl1','safety','Reported to Police',?,?)`).run(AT, AT);
    const body = await (await h.request('/cases/k1')).text();
    expect(body).toContain('class="flags"');
    expect(body).toContain('Reported to Police');
    // And it says where to go to take it down, because it is not this record's.
    expect(body).toContain('On the client');
  });

  it("a warning on a matter stays on that matter", async () => {
    const h = mountModule(clientsModule, { user: USER });
    seed(h.db);
    h.db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                  VALUES ('f1','case','k1','money','Fees unpaid since June',?,?)`).run(AT, AT);
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).not.toContain('Fees unpaid since June');
  });

  it('does not show one that has lapsed', async () => {
    const h = mountModule(clientsModule, { user: USER });
    seed(h.db);
    h.db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at,
                                     expires_on, updated_at)
                  VALUES ('f1','client','cl1','contact','Overseas until March','2020-01-01',
                          '2020-02-01','2020-01-01')`).run();
    const body = await (await h.request('/clients/cl1')).text();
    expect(body).not.toContain('class="flags"');
    // But it is still on the record, as history.
    expect(body).toContain('Warnings taken down');
    expect(body).toContain('Overseas until March');
  });
});

describe('where a warning came from', () => {
  // Every warning loaded from the practice folders restates a fact written down
  // somewhere. Without the matter named, a warning read a year later is a claim
  // you either believe or go looking for.
  it('keeps the matter a warning was read off, and lets it be nothing', () => {
    const db = migratedSqlite();
    seed(db);
    db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at,
                                   source_case_id)
                VALUES ('f1','client','cl1','immigration','Visitor visa refused 8 December 2023.',?,?,'k1')`)
      .run(AT, AT);
    db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at)
                VALUES ('f2','client','cl1','safety','Do not phone — she is in a refuge.',?,?)`)
      .run(AT, AT);
    const rows = db.prepare(`SELECT id, source_case_id FROM flags ORDER BY id`).all();
    expect(rows).toEqual([
      { id: 'f1', source_case_id: 'k1' },
      { id: 'f2', source_case_id: null },
    ]);
  });

  it('refuses to cite a matter that does not exist', () => {
    const db = migratedSqlite();
    seed(db);
    db.prepare('PRAGMA foreign_keys = ON').run();
    expect(attempt(db, `INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at,
                                           updated_at, source_case_id)
                        VALUES ('f1','client','cl1','immigration','Refused.',?,?,'no-such-case')`, AT, AT))
      .toMatch(/FOREIGN KEY/i);
  });

  it('keeps the warning when the matter it cited is deleted', () => {
    // The fact is still true. It loses its citation, not its point.
    const db = migratedSqlite();
    seed(db);
    db.prepare('PRAGMA foreign_keys = ON').run();
    db.prepare(`INSERT INTO flags (id, entity_type, entity_id, kind, body, raised_at, updated_at,
                                   source_case_id)
                VALUES ('f1','client','cl1','immigration','Visitor visa refused.',?,?,'k1')`).run(AT, AT);
    db.prepare(`DELETE FROM cases WHERE id = 'k1'`).run();
    const rows = db.prepare(`SELECT body, source_case_id FROM flags WHERE id = 'f1'`).all();
    expect(rows).toEqual([{ body: 'Visitor visa refused.', source_case_id: null }]);
  });
});
