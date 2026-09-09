/**
 * Five minutes to fix a slip.
 *
 * Reported on 1 September 2026: a file note was saved with the wrong date on
 * it and there was no way to put it right.
 *
 * Migration 0014 made entries append-only and that reasoning still holds in
 * full — a note editable months later is a record of what somebody now wishes
 * had happened, and it is worth nothing in a complaint or a Tribunal appeal.
 * What is admitted here is narrower: for the first five minutes a note is not
 * yet a record anybody has relied on. Refusing that correction does not protect
 * the file; it puts a wrong date on it forever, with a second note underneath
 * explaining the first.
 *
 * The window is enforced by the database, so the tests attack the database.
 */

import { describe, expect, it } from 'vitest';
import { migratedSqlite, mountModule, fakeUser } from './support/d1';
import { CORRECTION_WINDOW_MINUTES, correctable } from '../src/core/timeline';
import { notesModule } from '../src/modules/notes';
import { CHOOSABLE_ENTRY_KINDS, ENTRY_KINDS, ENTRY_KIND_LABELS } from '../src/domain';
import { readFileSync } from 'node:fs';

const AT = '2026-09-01T09:00:00Z';
const USER = fakeUser();

function seeded() {
  const db = migratedSqlite();
  db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
              VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
  db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
              VALUES ('cl1','CL-1','individual','A PERSON','active',?,?)`).run(AT, AT);
  return db;
}
/**
 * Times relative to now, because the window is measured against the database's
 * own clock (migration 0057) rather than against a timestamp the caller
 * supplies. A test pinned to a fixed date would be testing the caller's word.
 */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const now = () => new Date().toISOString();

const note = (db: any, id: string, createdAt = ago(1), kind = 'note') =>
  db.prepare(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at,
                                   pinned, created_at, created_by)
              VALUES (?, 'client','cl1', ?, 'As written', ?, 0, ?, ?)`)
    .run(id, kind, createdAt, createdAt, USER.id);
const attempt = (db: any, sql: string, ...params: unknown[]) => {
  try { db.prepare(sql).run(...params); return null; } catch (e: any) { return e.message as string; }
};

describe('the database decides, not the screen', () => {
  it('allows one correction inside the window', () => {
    const db = seeded();
    note(db, 'e1');
    expect(attempt(db, `UPDATE entries SET body='Corrected', edited_at=? WHERE id='e1'`, now()))
      .toBeNull();
    const after = db.prepare("SELECT body, edited_at FROM entries WHERE id='e1'").all() as any[];
    expect(after[0].body).toBe('Corrected');
    expect(after[0].edited_at).toBeTruthy();
  });

  it('refuses a second one, even a minute later', () => {
    const db = seeded();
    note(db, 'e1');
    db.prepare(`UPDATE entries SET body='Corrected', edited_at=? WHERE id='e1'`).run(now());
    expect(attempt(db, `UPDATE entries SET body='Again', edited_at=? WHERE id='e1'`, now()))
      .toMatch(/append-only/);
  });

  it('refuses one after the window has passed', () => {
    const db = seeded();
    note(db, 'e1', ago(6));
    expect(attempt(db, `UPDATE entries SET body='Too late', edited_at=? WHERE id='e1'`, now()))
      .toMatch(/append-only/);
  });

  it('refuses an edit that does not admit to being one', () => {
    // Without `edited_at` the page could not show the note as corrected, so
    // the correction would be invisible. That is the thing being prevented.
    const db = seeded();
    note(db, 'e1');
    expect(attempt(db, `UPDATE entries SET body='Sneaky' WHERE id='e1'`)).toMatch(/append-only/);
  });

  it('refuses an edited_at that is a fiction', () => {
    // The gap review found: without this, a handler that stamped
    // `edited_at = created_at + a second` could edit a note years later and
    // pass every check. The window is measured against the database's own
    // clock now, so the claimed moment has to be the real one.
    const db = seeded();
    note(db, 'e1', '2020-01-01T09:00:00Z');
    expect(attempt(db, `UPDATE entries SET body='Years later', edited_at='2020-01-01T09:00:01Z' WHERE id='e1'`))
      .toMatch(/append-only/);
  });

  it('refuses to rewrite a note the register wrote about itself', () => {
    // A system entry is nobody's slip: no person typed it. Refused by the
    // database, not only by the screen that decides whether to offer a button.
    const db = seeded();
    note(db, 'e1', ago(1), 'system');
    expect(attempt(db, `UPDATE entries SET body='Rewritten', edited_at=? WHERE id='e1'`, now()))
      .toMatch(/append-only/);
  });

  it('keeps what the note said before, written by the database', () => {
    // Not by the route. The whole reason this rule is in a trigger is that a
    // second handler must not be able to disagree with it, and a second handler
    // that forgot the audit row would lose the original.
    const db = seeded();
    note(db, 'e1');
    db.prepare(`UPDATE entries SET body='Corrected', edited_at=? WHERE id='e1'`).run(now());
    const kept = db.prepare(
      "SELECT actor_label, meta_json FROM audit_log WHERE action='entry.corrected_text_kept'")
      .all() as Array<{ actor_label: string; meta_json: string }>;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.actor_label).toBe('database');
    expect(kept[0]!.meta_json).toContain('As written');
  });

  it('never lets who wrote it, or when it was written, change', () => {
    const db = seeded();
    note(db, 'e1');
    const at = now();
    for (const sql of [
      `UPDATE entries SET created_by=NULL, edited_at=? WHERE id='e1'`,
      `UPDATE entries SET created_at='2020-01-01T00:00:00Z', edited_at=? WHERE id='e1'`,
    ]) expect(attempt(db, sql, at), sql).toMatch(/append-only/);
  });

  /**
   * Where a note is filed used to be frozen with everything else, and since
   * migration 0076 it is not. That is a deliberate narrowing of this rule, made
   * so that deleting a matter can move its notes onto the client instead of
   * destroying them — a note is a record of a conversation, not a record of
   * which folder somebody first put it in.
   *
   * What the note *says* is untouched by that change, and the two tests below
   * are the whole of the difference: it may be moved, and only somewhere real.
   */
  it('lets a note be re-filed onto a client who exists', () => {
    const db = seeded();
    db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                VALUES ('cl2','CL-2','individual','ANOTHER PERSON','active',?,?)`).run(AT, AT);
    note(db, 'e1');
    expect(attempt(db, `UPDATE entries SET entity_id='cl2' WHERE id='e1'`)).toBeNull();
    const after = db.prepare("SELECT entity_id, body FROM entries WHERE id='e1'").all() as any[];
    // Moved, and word for word what it was.
    expect(after[0]).toEqual({ entity_id: 'cl2', body: 'As written' });
  });

  it('refuses to re-file a note onto something that is not there', () => {
    const db = seeded();
    note(db, 'e1');
    for (const sql of [
      `UPDATE entries SET entity_type='client', entity_id='nobody' WHERE id='e1'`,
      `UPDATE entries SET entity_id='cl2' WHERE id='e1'`,
      // Not a client at all: a note may only ever move up to the person.
      `UPDATE entries SET entity_type='case', entity_id='k1' WHERE id='e1'`,
    ]) expect(attempt(db, sql), sql).toMatch(/re-filed onto a client who exists/);
  });

  it('still refuses a delete', () => {
    const db = seeded();
    note(db, 'e1');
    expect(attempt(db, `DELETE FROM entries WHERE id='e1'`)).toMatch(/append-only/);
  });

  it('corrects the date and the kind, which is what this is for', () => {
    const db = seeded();
    note(db, 'e1');
    expect(attempt(db, `UPDATE entries SET occurred_at='2026-08-28T00:00:00Z', kind='call',
                        edited_at=? WHERE id='e1'`, now())).toBeNull();
  });
});

describe('who is offered the button', () => {
  const base = { created_at: AT, created_by: USER.id, kind: 'note' as const };
  const justAfter = (minutes: number) => Date.parse(AT) + minutes * 60_000;

  it('the person who wrote it, inside the window', () => {
    expect(correctable(base, USER.id, justAfter(1))).toBe(true);
    expect(correctable(base, USER.id, justAfter(CORRECTION_WINDOW_MINUTES))).toBe(true);
  });

  it('nobody, once the window has passed', () => {
    expect(correctable(base, USER.id, justAfter(CORRECTION_WINDOW_MINUTES + 1))).toBe(false);
  });

  it('not somebody else', () => {
    // Correcting another person's note is not a correction, it is a rewrite.
    expect(correctable(base, 'someone_else', justAfter(1))).toBe(false);
    expect(correctable(base, null, justAfter(1))).toBe(false);
  });

  it('not a note the register wrote about itself', () => {
    expect(correctable({ ...base, kind: 'system' }, USER.id, justAfter(1))).toBe(false);
  });

  it('not one already corrected', () => {
    expect(correctable({ ...base, edited_at: AT }, USER.id, justAfter(1))).toBe(false);
  });
});

describe('correcting through the register', () => {
  const mount = () => mountModule(notesModule, { user: USER });
  const seed = (h: any, createdAt = new Date().toISOString()) => {
    h.db.prepare(`INSERT INTO users (id,email,name,password_hash,role,created_at,updated_at)
                  VALUES (?,?,?,'x',?,?,?)`).run(USER.id, USER.email, USER.name, USER.role, AT, AT);
    h.db.prepare(`INSERT INTO clients (id,ref,kind,full_name,status,created_at,updated_at)
                  VALUES ('cl1','CL-1','individual','A PERSON','active',?,?)`).run(AT, AT);
    h.db.prepare(`INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at,
                                       pinned, created_at, created_by)
                  VALUES ('e1','client','cl1','note','Wrong date', ?, 0, ?, ?)`)
      .run('2026-09-01T00:00:00.000Z', createdAt, USER.id);
  };

  it('saves the correction and keeps what it said before in the audit log', async () => {
    const h = mount();
    seed(h);
    const res = await h.post('/entries/e1/correct', {
      body: 'Right date', kind: 'note', occurred_at: '2026-08-28',
    });
    expect(res.status).toBe(303);
    const entry = (h.db.prepare("SELECT body, occurred_at, edited_at FROM entries WHERE id='e1'")
      .all() as any[])[0];
    expect(entry.body).toBe('Right date');
    expect(entry.occurred_at.slice(0, 10)).toBe('2026-08-28');
    expect(entry.edited_at).toBeTruthy();

    // Two rows, and each owns one fact. The route's says who made the
    // correction; the database's says what the note said before, written in the
    // same statement as the change so it is kept however the change was made.
    const who = h.db.prepare("SELECT meta_json FROM audit_log WHERE action='entry.corrected'")
      .all() as any[];
    expect(who).toHaveLength(1);
    expect(who[0].meta_json).toContain('e1');

    const what = h.db.prepare(
      "SELECT actor_label, meta_json FROM audit_log WHERE action='entry.corrected_text_kept'")
      .all() as any[];
    expect(what).toHaveLength(1);
    expect(what[0].actor_label).toBe('database');
    expect(what[0].meta_json).toContain('Wrong date');
  });

  it('refuses one that is too late, and says why', async () => {
    const h = mount();
    seed(h, '2026-09-01T00:00:00Z');
    const res = await h.post('/entries/e1/correct', { body: 'Too late', kind: 'note' });
    expect(res.headers.get('location')).toContain('err=');
    const entry = (h.db.prepare("SELECT body FROM entries WHERE id='e1'").all() as any[])[0];
    expect(entry.body).toBe('Wrong date');
  });
});

/**
 * The kinds a note may be.
 *
 * This used to read: *"expect(ENTRY_KINDS).toContain('prelim_consult')"*. It
 * passed for a week while choosing that kind on any of the three note forms
 * produced an error — `entries.kind` carried a CHECK listing eight values and
 * `prelim_consult` was not among them, so the database refused every row.
 *
 * The test asserted that a word was in a list in the same file the list is
 * written in. It could not fail. What it never asked was whether a note of that
 * kind could actually be written, which is the only thing anybody wanted to
 * know.
 *
 * So now it writes one of each, against the real schema.
 */
describe('the kinds a note may be', () => {
  it('can every one of them actually be written', () => {
    const db = seeded();
    expect(CHOOSABLE_ENTRY_KINDS.length, 'no kinds were read').toBeGreaterThan(4);
    for (const kind of CHOOSABLE_ENTRY_KINDS) {
      expect(() => db.prepare(
        `INSERT INTO entries (id, entity_type, entity_id, kind, body, occurred_at, created_at)
         VALUES (?, 'client', 'cl1', ?, 'x', ?, ?)`,
      ).run(`e_${kind}`, kind, AT, AT), `a note of kind ${kind} is refused`).not.toThrow();
    }
    const written = (db.prepare('SELECT COUNT(*) AS n FROM entries') as any).get() as { n: number };
    expect(written.n).toBe(CHOOSABLE_ENTRY_KINDS.length);
  });

  it('offers the two the practice asked for, by the names they use', () => {
    expect(CHOOSABLE_ENTRY_KINDS).toContain('status_query');
    expect(ENTRY_KIND_LABELS.status_query).toBe('Status query');
    expect(CHOOSABLE_ENTRY_KINDS).toContain('consult');
    expect(ENTRY_KIND_LABELS.consult).toBe('Consult');
  });

  it('does not offer a kind the register writes about itself', () => {
    // A note that says an email was sent, written by hand when none was, is a
    // record of something that did not happen — on a table that cannot be
    // corrected after five minutes. Asked for on 8 September; `system` was
    // already excluded, by three separate filters that each remembered it.
    for (const written of ['system', 'email_in', 'email_out'] as const) {
      expect(CHOOSABLE_ENTRY_KINDS, `${written} is still offered`).not.toContain(written);
      expect(ENTRY_KINDS, `${written} has stopped being a kind at all`).toContain(written);
    }
  });

  it('keeps one list rather than three that each remember to filter', () => {
    // Every form that writes a note reads the same list. Three did their own
    // filtering, all three remembered `system`, and none of them filtered
    // anything else — which is how the email kinds came to be on offer.
    for (const path of ['src/modules/cases/index.ts', 'src/modules/clients/index.ts',
                        'src/modules/inquiries/index.ts']) {
      const src = readFileSync(path, 'utf8');
      expect(src, `${path} still filters the list itself`)
        .not.toContain("ENTRY_KINDS.filter((k) => k !== 'system')");
      expect(src, `${path} does not use the shared list`).toContain('CHOOSABLE_ENTRY_KINDS');
    }
  });
});
