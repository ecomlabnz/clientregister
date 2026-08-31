import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/**
 * A note is a statement about a moment, so it carries the moment.
 *
 * "Called to find out, no update, will need to follow up in a week." Which
 * week? Six months later nobody can tell whether that call was yesterday or in
 * March. `completed_at` does not answer it: a note can be written before the
 * task is finished, changed afterwards, or left on a task still open.
 */

const tasks = readFileSync('src/modules/tasks/index.ts', 'utf8');
const at = '2026-07-01T00:00:00Z';

/** The register before 0038, so the backfill can be exercised on it. */
function before() {
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql') && !f.startsWith('0038')).sort()) {
    db.exec(readFileSync(`migrations/${f}`, 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
              VALUES ('u1', 'a@b.test', 'Tai', 'x', 'owner', ?, ?)`).run(at, at);
  return db;
}

type Db = ReturnType<typeof before>;

const apply38 = (db: Db) =>
  db.exec(readFileSync(
    `migrations/${readdirSync('migrations').find((f) => f.startsWith('0038'))!}`, 'utf8'));

const task = (db: Db, id: string, note: string | null, updated = at) =>
  db.prepare(`INSERT INTO tasks (id, title, status, assigned_to, completion_note,
                                 created_at, updated_at)
              VALUES (?, ?, 'open', 'u1', ?, ?, ?)`).run(id, `Task ${id}`, note, at, updated);

const rows = (db: Db, sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>;

describe('notes already written get their date from the record of them', () => {
  it('takes the time and the author from the audit log', () => {
    // The log recorded every note as it was written. That is the truth of when
    // it happened, rather than a guess from the task's own timestamps.
    const db = before();
    task(db, 't1', 'Called INZ, no update.', '2026-08-20T06:00:00Z');
    db.prepare(`INSERT INTO audit_log (id, at, actor_id, actor_label, action, entity_type, entity_id)
                VALUES ('a1', '2026-08-11T22:15:00Z', 'u1', 'Tai', 'task.note_recorded', 'task', 't1')`).run();
    apply38(db);
    expect(rows(db, 'SELECT completion_note_at, completion_note_by FROM tasks'))
      .toEqual([{ completion_note_at: '2026-08-11T22:15:00Z', completion_note_by: 'u1' }]);
  });

  it('falls back to the task when the log has nothing, and invents no author', () => {
    const db = before();
    task(db, 't1', 'An older note.', '2026-08-20T06:00:00Z');
    apply38(db);
    expect(rows(db, 'SELECT completion_note_at, completion_note_by FROM tasks'))
      .toEqual([{ completion_note_at: '2026-08-20T06:00:00Z', completion_note_by: null }]);
  });

  it('leaves a task with no note alone', () => {
    const db = before();
    task(db, 't1', null);
    apply38(db);
    expect(rows(db, 'SELECT completion_note_at FROM tasks')).toEqual([{ completion_note_at: null }]);
  });
});

describe('and an undated note cannot be written again', () => {
  const seeded = () => { const db = before(); apply38(db); return db; };

  it('refuses one on insert', () => {
    const db = seeded();
    expect(() => task(db, 't1', 'Something happened.')).toThrow(/when it was written/);
  });

  it('refuses one on update', () => {
    const db = seeded();
    task(db, 't1', null);
    expect(() => db.prepare(`UPDATE tasks SET completion_note = 'Something' WHERE id = 't1'`).run())
      .toThrow(/when it was written/);
  });

  it('refuses the stamp being cleared out from under a note', () => {
    const db = seeded();
    db.prepare(`INSERT INTO tasks (id, title, status, assigned_to, completion_note,
                                   completion_note_at, created_at, updated_at)
                VALUES ('t1', 'A task', 'open', 'u1', 'A note', ?, ?, ?)`).run(at, at, at);
    expect(() => db.prepare(`UPDATE tasks SET completion_note_at = NULL WHERE id = 't1'`).run())
      .toThrow(/when it was written/);
  });

  it('accepts one that carries its time', () => {
    const db = seeded();
    task(db, 't1', null);
    db.prepare(`UPDATE tasks SET completion_note = 'Rang them', completion_note_at = ?,
                                 completion_note_by = 'u1' WHERE id = 't1'`).run(at);
    expect(rows(db, 'SELECT completion_note_at FROM tasks')).toEqual([{ completion_note_at: at }]);
  });
});

describe('what the task page does with it', () => {
  it('shows when the note was written, and by whom when that is known', () => {
    // Both the page and the list say when. Written against the helper rather
    // than a formatter's name: what matters is that a moment is rendered as a
    // moment — with its time — not which function does it.
    expect(tasks).toContain('stamp(task.completion_note_at)');
    expect(tasks).toContain('noteAuthor ? html` by ${noteAuthor.name}`');
  });

  it('dates the note in the list as well', () => {
    expect(tasks).toContain('stamp(t.completion_note_at)');
  });

  it('does not redate a note that was not touched', () => {
    // Re-saving the edit form without going near the box would otherwise move
    // a call made in March to today, which is worse than no date at all.
    expect(tasks).toContain("const noteChanged = (completionNote ?? '') !== (existing.completion_note ?? '')");
    expect(tasks).toContain('noteChanged ? nowIso() : existing.completion_note_at');
  });

  it('offers finishing a task as one button, not a choice in a list', () => {
    // "Done" sat in a dropdown next to "Cancelled", which is a slip away from
    // the opposite of what was meant.
    const change = tasks.slice(tasks.indexOf("card('Change it'"));
    expect(change.slice(0, 900)).toContain("actionButton(`/tasks/${task.id}/status`, csrf, 'Done'");
    expect(change.slice(0, 900)).toContain("fields: { status: 'done', return_to: here }");
  });

  it('offers it only while the task is still open', () => {
    const change = tasks.slice(tasks.indexOf("card('Change it'"));
    expect(change.slice(0, 900)).toContain('${open');
  });
});
